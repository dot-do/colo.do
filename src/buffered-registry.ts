/**
 * Buffered Registry - Handles traffic spikes gracefully
 *
 * Key insight: DO creation doesn't need synchronous registry writes.
 * We can create DOs optimistically and register them async.
 *
 * Architecture:
 * - Creates are instant (ID generated locally, DO created immediately)
 * - Registration is queued and batched
 * - Reads go through R2 cache (eventually consistent)
 * - Registry DO handles batched writes, not individual requests
 *
 * This handles 100K creates/sec without overwhelming the registry DO.
 */

import type { RegistryEntry, CreateOptions } from './registry.js'
import { LRUCache } from './lru-cache.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Pending registration entry
 */
interface PendingEntry {
  namespace: string
  name: string
  id: string
  colo: string
  createdAt: number
  metadata?: Record<string, unknown>
  retries: number
}

/**
 * Buffer configuration
 */
export interface BufferConfig {
  /** Max entries before flush (default: 100) */
  batchSize: number
  /** Max time before flush in ms (default: 1000) */
  flushIntervalMs: number
  /** Max retries for failed registrations (default: 3) */
  maxRetries: number
  /** Retry delay in ms (default: 1000) */
  retryDelayMs: number
}

const DEFAULT_CONFIG: BufferConfig = {
  batchSize: 100,
  flushIntervalMs: 1000,
  maxRetries: 3,
  retryDelayMs: 1000,
}

// ============================================================================
// Local ID Generation (no registry needed)
// ============================================================================

/**
 * Generate a DO ID locally that hints at the target colo
 *
 * Format: COLO:name:timestamp:random
 * This is deterministic enough to reconstruct, random enough to avoid collisions
 */
export function generateLocalId(colo: string, name?: string): { id: string; generatedName: string } {
  const coloUpper = colo.toUpperCase()
  const timestamp = Date.now().toString(36)
  const random = crypto.randomUUID().slice(0, 8)
  const generatedName = name ?? `${coloUpper.toLowerCase()}-${random}`

  // The ID used for idFromName - includes colo hint
  const id = `${coloUpper}:${generatedName}:${timestamp}:${random}`

  return { id, generatedName }
}

/**
 * Parse a locally generated ID
 */
export function parseLocalId(id: string): { colo: string; name: string; timestamp: number } | null {
  const parts = id.split(':')
  if (parts.length < 3) return null

  return {
    colo: parts[0],
    name: parts[1],
    timestamp: parseInt(parts[2], 36),
  }
}

// ============================================================================
// Write Buffer (Worker-level batching)
// ============================================================================

/**
 * Worker-level write buffer for registration
 *
 * Collects pending registrations and flushes them in batches.
 * This runs in the Worker, not the DO.
 */
export class RegistrationBuffer {
  private buffer: PendingEntry[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private config: BufferConfig
  private registryDO: DurableObjectNamespace
  private onError?: (error: Error, entries: PendingEntry[]) => void

  constructor(
    registryDO: DurableObjectNamespace,
    config: Partial<BufferConfig> = {},
    onError?: (error: Error, entries: PendingEntry[]) => void
  ) {
    this.registryDO = registryDO
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.onError = onError
  }

  /**
   * Queue an entry for registration (non-blocking)
   */
  queue(entry: Omit<PendingEntry, 'retries'>): void {
    this.buffer.push({ ...entry, retries: 0 })

    // Flush if batch size reached
    if (this.buffer.length >= this.config.batchSize) {
      this.flush()
    } else if (!this.flushTimer) {
      // Schedule flush
      this.flushTimer = setTimeout(() => this.flush(), this.config.flushIntervalMs)
    }
  }

  /**
   * Flush pending registrations to the registry DO
   */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }

    if (this.buffer.length === 0) return

    const batch = this.buffer.splice(0, this.config.batchSize)

    try {
      await this.sendBatch(batch)
    } catch (error) {
      // Retry failed entries
      const retryable = batch.filter(e => e.retries < this.config.maxRetries)
      if (retryable.length > 0) {
        retryable.forEach(e => e.retries++)
        // Re-queue with delay
        setTimeout(() => {
          this.buffer.unshift(...retryable)
          if (!this.flushTimer) {
            this.flushTimer = setTimeout(() => this.flush(), this.config.flushIntervalMs)
          }
        }, this.config.retryDelayMs)
      }

      // Report permanently failed entries
      const failed = batch.filter(e => e.retries >= this.config.maxRetries)
      if (failed.length > 0 && this.onError) {
        this.onError(error as Error, failed)
      }
    }
  }

  /**
   * Send a batch to the registry DO
   */
  private async sendBatch(entries: PendingEntry[]): Promise<void> {
    const stub = this.registryDO.get(this.registryDO.idFromName('global'))

    const response = await stub.fetch('http://registry/_rpc/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'registerBatch', entries }),
    })

    if (!response.ok) {
      throw new Error(`Registry batch failed: ${response.status}`)
    }
  }

  /**
   * Get buffer stats
   */
  get stats(): { pending: number; config: BufferConfig } {
    return {
      pending: this.buffer.length,
      config: this.config,
    }
  }
}

// ============================================================================
// Sharded Registry (for extreme scale)
// ============================================================================

/**
 * Number of registry shards
 * Each shard handles 1/N of the namespaces
 */
const DEFAULT_SHARD_COUNT = 16

/**
 * Get the shard ID for a namespace
 */
function getShardId(namespace: string, shardCount: number = DEFAULT_SHARD_COUNT): number {
  let hash = 0
  for (let i = 0; i < namespace.length; i++) {
    hash = ((hash << 5) - hash) + namespace.charCodeAt(i)
    hash = hash & hash
  }
  return Math.abs(hash) % shardCount
}

/**
 * Sharded registry client
 *
 * Distributes load across multiple registry DOs by namespace.
 * Each namespace is assigned to a specific shard.
 */
export class ShardedRegistry {
  private registryDO: DurableObjectNamespace
  private shardCount: number
  private buffers: Map<number, RegistrationBuffer> = new Map()
  private bufferConfig: Partial<BufferConfig>

  constructor(
    registryDO: DurableObjectNamespace,
    options: {
      shardCount?: number
      bufferConfig?: Partial<BufferConfig>
    } = {}
  ) {
    this.registryDO = registryDO
    this.shardCount = options.shardCount ?? DEFAULT_SHARD_COUNT
    this.bufferConfig = options.bufferConfig ?? {}
  }

  /**
   * Get the registry DO stub for a namespace
   */
  private getStub(namespace: string): DurableObjectStub {
    const shardId = getShardId(namespace, this.shardCount)
    const id = this.registryDO.idFromName(`shard-${shardId}`)
    return this.registryDO.get(id)
  }

  /**
   * Get or create a buffer for a shard
   */
  private getBuffer(namespace: string): RegistrationBuffer {
    const shardId = getShardId(namespace, this.shardCount)
    let buffer = this.buffers.get(shardId)
    if (!buffer) {
      // Create a "shard-specific" DO namespace view
      const shardStub = {
        get: () => this.getStub(namespace),
        idFromName: () => this.registryDO.idFromName(`shard-${shardId}`),
      } as unknown as DurableObjectNamespace

      buffer = new RegistrationBuffer(shardStub, this.bufferConfig)
      this.buffers.set(shardId, buffer)
    }
    return buffer
  }

  /**
   * Create a DO with buffered registration
   *
   * Returns immediately - registration happens async
   */
  create<NS extends DurableObjectNamespace>(
    targetNamespace: NS,
    namespace: string,
    options: CreateOptions & { name?: string }
  ): { stub: DurableObjectStub; entry: RegistryEntry } {
    const { id, generatedName } = generateLocalId(options.in, options.name)
    const now = Date.now()

    // Create DO immediately
    const doId = targetNamespace.idFromName(id)
    const stub = targetNamespace.get(doId)

    // Queue registration (non-blocking)
    const entry: RegistryEntry = {
      name: generatedName,
      namespace,
      id,
      colo: options.in.toUpperCase(),
      createdAt: now,
      accessedAt: now,
      metadata: options.metadata,
    }

    this.getBuffer(namespace).queue({
      namespace,
      name: generatedName,
      id,
      colo: entry.colo,
      createdAt: now,
      metadata: options.metadata,
    })

    return { stub, entry }
  }

  /**
   * Get an entry (from registry DO, use R2 cache for hot path)
   */
  async get(namespace: string, name: string): Promise<RegistryEntry | null> {
    const stub = this.getStub(namespace)

    const response = await stub.fetch('http://registry/_rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'get', args: [namespace, name] }),
    })

    if (!response.ok) return null
    return response.json()
  }

  /**
   * Flush all pending registrations
   */
  async flushAll(): Promise<void> {
    await Promise.all(
      Array.from(this.buffers.values()).map(b => b.flush())
    )
  }

  /**
   * Get stats for all shards
   */
  get stats(): { shards: number; buffers: Array<{ shard: number; pending: number }> } {
    return {
      shards: this.shardCount,
      buffers: Array.from(this.buffers.entries()).map(([shard, buffer]) => ({
        shard,
        pending: buffer.stats.pending,
      })),
    }
  }
}

// ============================================================================
// Simple API (hides complexity)
// ============================================================================

/**
 * Options for the buffered env wrapper
 */
export interface BufferedEnvOptions {
  /** Registry DO namespace */
  registry: DurableObjectNamespace
  /** R2 bucket for snapshots */
  bucket: R2Bucket
  /** Number of registry shards (default: 16) */
  shardCount?: number
  /** Buffer configuration */
  bufferConfig?: Partial<BufferConfig>
  /** Cache TTL in ms (default: 60000) */
  cacheTtl?: number
}

/**
 * Snapshot cache (worker-level, LRU eviction at 50 entries)
 */
const bufferedSnapshotCache = new LRUCache<string, { entries: Map<string, RegistryEntry>; fetchedAt: number }>(50)

/**
 * Create a buffered, sharded environment wrapper
 *
 * This is the recommended way to use the registry at scale.
 *
 * @example
 * ```typescript
 * import { env } from 'cloudflare:workers'
 * import { createBufferedEnv } from 'colo.do'
 *
 * const $ = createBufferedEnv(env, {
 *   registry: env.REGISTRY_DO,
 *   bucket: env.REGISTRY_BUCKET,
 * })
 *
 * // Create is instant (async registration)
 * const { stub } = $.create.POSTGRES({ in: 'LAX' })
 *
 * // Get uses R2 cache
 * const result = await $.get.POSTGRES('my-db')
 * ```
 */
export function createBufferedEnv<Env extends Record<string, unknown>>(
  env: Env,
  options: BufferedEnvOptions
) {
  const shardedRegistry = new ShardedRegistry(options.registry, {
    shardCount: options.shardCount,
    bufferConfig: options.bufferConfig,
  })

  const cacheTtl = options.cacheTtl ?? 60000

  // Helper to get namespace
  const getNamespace = (name: string): DurableObjectNamespace => {
    const ns = env[name]
    if (!ns || typeof ns !== 'object' || !('idFromName' in ns)) {
      throw new Error(`'${name}' is not a valid DurableObjectNamespace`)
    }
    return ns as DurableObjectNamespace
  }

  // Helper to get cached snapshot
  const getCachedEntry = async (namespace: string, name: string): Promise<RegistryEntry | null> => {
    const cached = bufferedSnapshotCache.get(namespace)
    if (cached && Date.now() - cached.fetchedAt < cacheTtl) {
      return cached.entries.get(name) ?? null
    }

    // Fetch from R2
    const key = `registry/${namespace}/snapshot.json`
    const object = await options.bucket.get(key)
    if (!object) return null

    const snapshot = await object.json<{ entries: RegistryEntry[] }>()
    const entriesMap = new Map(snapshot.entries.map(e => [e.name, e]))
    bufferedSnapshotCache.set(namespace, { entries: entriesMap, fetchedAt: Date.now() })

    return entriesMap.get(name) ?? null
  }

  return {
    /**
     * Create a new DO (instant, registration is async)
     */
    create: new Proxy({} as Record<string, (options: CreateOptions & { name?: string }) => { stub: DurableObjectStub; entry: RegistryEntry; name: string }>, {
      get(_, namespace: string) {
        return (options: CreateOptions & { name?: string }) => {
          const ns = getNamespace(namespace)
          const { stub, entry } = shardedRegistry.create(ns, namespace, options)
          return { stub, entry, name: entry.name }
        }
      },
    }),

    /**
     * Get an existing DO (uses cache, eventually consistent)
     */
    get: new Proxy({} as Record<string, (name: string) => Promise<{ stub: DurableObjectStub; entry: RegistryEntry } | null>>, {
      get(_, namespace: string) {
        return async (name: string) => {
          const ns = getNamespace(namespace)

          // Try cache first
          let entry = await getCachedEntry(namespace, name)

          // Fall back to registry DO
          if (!entry) {
            entry = await shardedRegistry.get(namespace, name)
          }

          if (!entry) return null

          const doId = ns.idFromName(entry.id)
          const stub = ns.get(doId)

          return { stub, entry }
        }
      },
    }),

    /**
     * Flush all pending registrations (call in ctx.waitUntil)
     */
    flush: () => shardedRegistry.flushAll(),

    /**
     * Get registry stats
     */
    stats: () => shardedRegistry.stats,

    /**
     * Direct access to namespaces (bypasses registry)
     */
    raw: new Proxy({} as Record<string, DurableObjectNamespace>, {
      get(_, namespace: string) {
        return getNamespace(namespace)
      },
    }),
  }
}
