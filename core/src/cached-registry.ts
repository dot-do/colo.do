/**
 * Cache API Registry - Zero-cost reads with SWR
 *
 * Uses Cloudflare Cache API (FREE) for registry lookups:
 * - Cache hit: Return immediately, revalidate in background (SWR)
 * - Cache miss: Fetch from RegistryDO, cache result
 * - New entry: Not in cache → triggers DO fetch
 *
 * Cost comparison:
 * - Cache API reads: FREE (unlimited)
 * - R2 reads: $0.36/M
 * - KV reads: $0.50/M
 * - DO SQLite reads: $0.001/M (only on cache miss)
 *
 * @example
 * ```typescript
 * import { createCachedEnv } from 'colo.do'
 *
 * const $ = createCachedEnv(env, {
 *   registry: env.REGISTRY_DO,
 *   cacheKeyPrefix: 'https://registry.colo.do',
 * })
 *
 * // Reads from cache (FREE), revalidates in background
 * const result = await $.get.POSTGRES('my-db')
 *
 * // Creates are instant, registration queued
 * const { stub } = $.create.POSTGRES({ in: 'LAX' })
 * ```
 */

import type { RegistryEntry, CreateOptions } from './registry.js'
import { generateLocalId, ShardedRegistry, type BufferConfig } from './buffered-registry.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Cache configuration
 */
export interface CacheConfig {
  /** Cache key prefix (must be a valid URL origin) */
  cacheKeyPrefix: string
  /** TTL for cache entries in seconds (default: 60) */
  ttlSeconds?: number
  /** Stale TTL - how long to serve stale while revalidating (default: 300) */
  staleTtlSeconds?: number
  /** Whether to use SWR pattern (default: true) */
  staleWhileRevalidate?: boolean
}

/**
 * Options for cached environment wrapper
 */
export interface CachedEnvOptions {
  /** Registry DO namespace */
  registry: DurableObjectNamespace
  /** Cache configuration */
  cache?: Partial<CacheConfig>
  /** Number of registry shards (default: 16) */
  shardCount?: number
  /** Buffer configuration for writes */
  bufferConfig?: Partial<BufferConfig>
}

const DEFAULT_CACHE_CONFIG: CacheConfig = {
  cacheKeyPrefix: 'https://registry.internal',
  ttlSeconds: 60,
  staleTtlSeconds: 300,
  staleWhileRevalidate: true,
}

// ============================================================================
// Cache Helpers
// ============================================================================

/**
 * Get the cache instance
 * Note: In Workers, we use the default cache
 */
function getCache(): Cache {
  return caches.default
}

/**
 * Build a cache key for a registry entry
 */
function buildCacheKey(prefix: string, namespace: string, name: string): string {
  return `${prefix}/registry/${namespace}/${encodeURIComponent(name)}`
}

/**
 * Build a cache key for a namespace listing
 */
function buildListCacheKey(prefix: string, namespace: string): string {
  return `${prefix}/registry/${namespace}/_list`
}

/**
 * Parse cache headers to check staleness
 */
function isCacheStale(response: Response): boolean {
  const age = response.headers.get('age')
  const cacheControl = response.headers.get('cache-control')

  if (!age || !cacheControl) return false

  const maxAge = cacheControl.match(/max-age=(\d+)/)
  if (!maxAge) return false

  return parseInt(age) > parseInt(maxAge[1])
}

// ============================================================================
// Cached Registry Client
// ============================================================================

/**
 * Registry client with Cache API and SWR
 */
export class CachedRegistryClient {
  private registry: ShardedRegistry
  private cacheConfig: CacheConfig
  private pendingRevalidations = new Set<string>()

  constructor(
    registryDO: DurableObjectNamespace,
    options: {
      shardCount?: number
      bufferConfig?: Partial<BufferConfig>
      cache?: Partial<CacheConfig>
    } = {}
  ) {
    this.registry = new ShardedRegistry(registryDO, {
      shardCount: options.shardCount,
      bufferConfig: options.bufferConfig,
    })
    this.cacheConfig = { ...DEFAULT_CACHE_CONFIG, ...options.cache }
  }

  /**
   * Get an entry with SWR caching
   */
  async get(namespace: string, name: string, ctx?: ExecutionContext): Promise<RegistryEntry | null> {
    const cache = getCache()
    const cacheKey = buildCacheKey(this.cacheConfig.cacheKeyPrefix, namespace, name)

    // Try cache first
    const cachedResponse = await cache.match(cacheKey)

    if (cachedResponse) {
      const entry = await cachedResponse.json<RegistryEntry>()

      // Check if stale and should revalidate
      if (this.cacheConfig.staleWhileRevalidate && isCacheStale(cachedResponse)) {
        // Revalidate in background (don't await)
        const revalidateKey = `${namespace}:${name}`
        if (!this.pendingRevalidations.has(revalidateKey)) {
          this.pendingRevalidations.add(revalidateKey)
          const revalidate = this.revalidate(namespace, name).finally(() => {
            this.pendingRevalidations.delete(revalidateKey)
          })
          ctx?.waitUntil(revalidate)
        }
      }

      return entry
    }

    // Cache miss - fetch from registry DO
    return this.fetchAndCache(namespace, name)
  }

  /**
   * Fetch from DO and cache the result
   */
  private async fetchAndCache(namespace: string, name: string): Promise<RegistryEntry | null> {
    const entry = await this.registry.get(namespace, name)

    if (entry) {
      await this.cacheEntry(namespace, name, entry)
    }

    return entry
  }

  /**
   * Revalidate a cache entry
   */
  private async revalidate(namespace: string, name: string): Promise<void> {
    try {
      await this.fetchAndCache(namespace, name)
    } catch (error) {
      // Revalidation failed - stale data will continue to be served
      console.error(`Revalidation failed for ${namespace}:${name}:`, error)
    }
  }

  /**
   * Cache an entry
   */
  private async cacheEntry(namespace: string, name: string, entry: RegistryEntry): Promise<void> {
    const cache = getCache()
    const cacheKey = buildCacheKey(this.cacheConfig.cacheKeyPrefix, namespace, name)

    const response = new Response(JSON.stringify(entry), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${this.cacheConfig.ttlSeconds}, stale-while-revalidate=${this.cacheConfig.staleTtlSeconds}`,
      },
    })

    await cache.put(cacheKey, response)
  }

  /**
   * Create a new entry (instant, registration is async)
   */
  create<NS extends DurableObjectNamespace>(
    targetNamespace: NS,
    namespace: string,
    options: CreateOptions & { name?: string },
    ctx?: ExecutionContext
  ): { stub: DurableObjectStub; entry: RegistryEntry; name: string } {
    const result = this.registry.create(targetNamespace, namespace, options)

    // Pre-cache the new entry
    ctx?.waitUntil(this.cacheEntry(namespace, result.entry.name, result.entry))

    return { ...result, name: result.entry.name }
  }

  /**
   * Invalidate cache for an entry
   */
  async invalidate(namespace: string, name: string): Promise<void> {
    const cache = getCache()
    const cacheKey = buildCacheKey(this.cacheConfig.cacheKeyPrefix, namespace, name)
    await cache.delete(cacheKey)
  }

  /**
   * Invalidate entire namespace cache
   */
  async invalidateNamespace(namespace: string): Promise<void> {
    const cache = getCache()
    const listKey = buildListCacheKey(this.cacheConfig.cacheKeyPrefix, namespace)
    await cache.delete(listKey)
    // Note: Individual entries will expire via TTL
  }

  /**
   * Flush pending registrations
   */
  flush(): Promise<void> {
    return this.registry.flushAll()
  }

  /**
   * Get stats
   */
  get stats() {
    return {
      ...this.registry.stats,
      pendingRevalidations: this.pendingRevalidations.size,
    }
  }
}

// ============================================================================
// Simple API
// ============================================================================

/**
 * Create a cached environment wrapper
 *
 * Uses Cache API (FREE) for reads with SWR pattern.
 *
 * @example
 * ```typescript
 * import { createCachedEnv } from 'colo.do'
 *
 * export default {
 *   async fetch(request, env, ctx) {
 *     const $ = createCachedEnv(env, {
 *       registry: env.REGISTRY_DO,
 *     })
 *
 *     // Reads from cache (FREE)
 *     const result = await $.get.POSTGRES('my-db', ctx)
 *     if (result) {
 *       const data = await result.stub.query('SELECT * FROM users')
 *     }
 *
 *     // Creates are instant
 *     const { stub, name } = $.create.POSTGRES({ in: 'LAX' }, ctx)
 *
 *     // Flush pending registrations
 *     ctx.waitUntil($.flush())
 *   }
 * }
 * ```
 */
export function createCachedEnv<Env extends Record<string, unknown>>(
  env: Env,
  options: CachedEnvOptions
) {
  const client = new CachedRegistryClient(options.registry, {
    shardCount: options.shardCount,
    bufferConfig: options.bufferConfig,
    cache: options.cache,
  })

  // Helper to get namespace
  const getNamespace = (name: string): DurableObjectNamespace => {
    const ns = env[name]
    if (!ns || typeof ns !== 'object' || !('idFromName' in ns)) {
      throw new Error(`'${name}' is not a valid DurableObjectNamespace`)
    }
    return ns as DurableObjectNamespace
  }

  return {
    /**
     * Get an existing DO by name (uses Cache API with SWR)
     * Pass ctx to enable background revalidation
     */
    get: new Proxy({} as Record<string, (name: string, ctx?: ExecutionContext) => Promise<{ stub: DurableObjectStub; entry: RegistryEntry } | null>>, {
      get(_, namespace: string) {
        return async (name: string, ctx?: ExecutionContext) => {
          const ns = getNamespace(namespace)
          const entry = await client.get(namespace, name, ctx)

          if (!entry) return null

          const doId = ns.idFromName(entry.id)
          const stub = ns.get(doId)

          return { stub, entry }
        }
      },
    }),

    /**
     * Create a new DO (instant, registration + caching is async)
     * Pass ctx to enable background caching
     */
    create: new Proxy({} as Record<string, (options: CreateOptions & { name?: string }, ctx?: ExecutionContext) => { stub: DurableObjectStub; entry: RegistryEntry; name: string }>, {
      get(_, namespace: string) {
        return (options: CreateOptions & { name?: string }, ctx?: ExecutionContext) => {
          const ns = getNamespace(namespace)
          return client.create(ns, namespace, options, ctx)
        }
      },
    }),

    /**
     * Invalidate cache for an entry
     */
    invalidate: (namespace: string, name: string) => client.invalidate(namespace, name),

    /**
     * Flush pending registrations
     */
    flush: () => client.flush(),

    /**
     * Get stats
     */
    stats: () => client.stats,

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
