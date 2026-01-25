/**
 * Environment Wrapper for Location-Aware DO Access
 *
 * Provides a clean API for creating and accessing DOs with colo awareness:
 *
 * ```typescript
 * import { env } from 'cloudflare:workers'
 * import { wrapEnv } from 'colo.do'
 *
 * const do = wrapEnv(env, { registry: env.REGISTRY_DO, bucket: env.REGISTRY_BUCKET })
 *
 * // Create a new DO in LAX
 * const { stub, name } = await do.create.POSTGRES({ in: 'LAX' })
 *
 * // Get existing DO by name
 * const stub = await do.get.POSTGRES('my-database')
 *
 * // Get with colo preference
 * const stub = await do.get.POSTGRES('my-database', { prefer: 'LAX' })
 *
 * // Get or create
 * const stub = await do.getOrCreate.POSTGRES('my-database', { in: 'LAX' })
 * ```
 */

import type { RegistryEntry, CreateOptions, GetOptions, RegistrySnapshot } from './registry.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Options for wrapping the environment
 */
export interface WrapEnvOptions {
  /** Registry DO namespace */
  registry: DurableObjectNamespace
  /** R2 bucket for registry snapshots */
  bucket: R2Bucket
  /** Cache TTL in milliseconds (default: 60000) */
  cacheTtl?: number
}

/**
 * Result of creating a new DO
 */
export interface CreateResult {
  /** The DO stub */
  stub: DurableObjectStub
  /** The generated name */
  name: string
  /** The registry entry */
  entry: RegistryEntry
}

/**
 * Result of getting an existing DO
 */
export interface GetResult {
  /** The DO stub */
  stub: DurableObjectStub
  /** The registry entry */
  entry: RegistryEntry
  /** Whether this was a cache hit */
  cached: boolean
}

/**
 * The wrapped environment proxy
 */
export interface WrappedEnv {
  /**
   * Create a new named DO instance
   *
   * @example
   * const { stub, name } = await do.create.POSTGRES({ in: 'LAX' })
   */
  create: {
    [namespace: string]: (options: CreateOptions & { name?: string }) => Promise<CreateResult>
  }

  /**
   * Get an existing DO by name
   *
   * @example
   * const stub = await do.get.POSTGRES('my-database')
   * const stub = await do.get.POSTGRES('my-database', { prefer: 'LAX' })
   * const stub = await do.get.POSTGRES('my-database', { in: 'LAX' }) // throws if not in LAX
   */
  get: {
    [namespace: string]: (name: string, options?: GetOptions) => Promise<GetResult | null>
  }

  /**
   * Get or create a DO
   *
   * @example
   * const { stub, created } = await do.getOrCreate.POSTGRES('my-database', { in: 'LAX' })
   */
  getOrCreate: {
    [namespace: string]: (name: string, options: CreateOptions) => Promise<GetResult & { created: boolean }>
  }

  /**
   * List all DOs in a namespace
   *
   * @example
   * const entries = await do.list.POSTGRES()
   * const entries = await do.list.POSTGRES({ colo: 'LAX' })
   */
  list: {
    [namespace: string]: (options?: { colo?: string; limit?: number; offset?: number }) => Promise<RegistryEntry[]>
  }

  /**
   * Delete a named DO from the registry
   * Note: This removes the registry entry, not the actual DO
   *
   * @example
   * await do.delete.POSTGRES('my-database')
   */
  delete: {
    [namespace: string]: (name: string) => Promise<boolean>
  }

  /**
   * Move a DO to a different colo
   * Creates a new DO in the target colo and updates the registry
   *
   * @example
   * const { stub, entry } = await do.move.POSTGRES('my-database', { to: 'ORD' })
   */
  move: {
    [namespace: string]: (name: string, options: { to: string }) => Promise<GetResult>
  }

  /**
   * Direct access to a DO namespace (bypasses registry)
   * Use this for raw idFromName/idFromString access
   */
  raw: {
    [namespace: string]: DurableObjectNamespace
  }
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * In-memory cache for registry snapshots
 */
const snapshotCache = new Map<string, { snapshot: RegistrySnapshot; fetchedAt: number }>()

/**
 * Get a cached snapshot from R2
 */
async function getSnapshot(
  bucket: R2Bucket,
  namespace: string,
  cacheTtl: number
): Promise<RegistrySnapshot | null> {
  // Check in-memory cache
  const cacheKey = namespace
  const cached = snapshotCache.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < cacheTtl) {
    return cached.snapshot
  }

  // Try R2
  const key = `registry/${namespace}/snapshot.json`
  const object = await bucket.get(key)

  if (!object) return null

  const snapshot = await object.json<RegistrySnapshot>()
  snapshotCache.set(cacheKey, { snapshot, fetchedAt: Date.now() })

  return snapshot
}

/**
 * Get the global registry DO stub
 */
function getRegistryStub(registryDO: DurableObjectNamespace): DurableObjectStub {
  const id = registryDO.idFromName('global')
  return registryDO.get(id)
}

/**
 * Call an RPC method on the registry DO
 */
async function callRegistry<T>(
  registryDO: DurableObjectNamespace,
  method: string,
  ...args: unknown[]
): Promise<T> {
  const stub = getRegistryStub(registryDO)

  // Use fetch with JSON-RPC style body
  // In production, this would use capnweb RPC
  const response = await stub.fetch('http://registry/_rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Registry error: ${error}`)
  }

  return response.json()
}

/**
 * Wrap the environment with location-aware DO access
 *
 * @example
 * ```typescript
 * import { env } from 'cloudflare:workers'
 * import { wrapEnv } from 'colo.do'
 *
 * const do = wrapEnv(env, {
 *   registry: env.REGISTRY_DO,
 *   bucket: env.REGISTRY_BUCKET
 * })
 *
 * // Create PostgresDO in LAX
 * const { stub } = await do.create.POSTGRES({ in: 'LAX' })
 *
 * // Get existing by name
 * const { stub } = await do.get.POSTGRES('my-database')
 * ```
 */
export function wrapEnv<Env extends Record<string, unknown>>(
  env: Env,
  options: WrapEnvOptions
): WrappedEnv {
  const { registry, bucket, cacheTtl = 60000 } = options

  // Helper to get a namespace from env
  const getNamespace = (name: string): DurableObjectNamespace => {
    const ns = env[name]
    if (!ns || typeof ns !== 'object' || !('idFromName' in ns)) {
      throw new Error(`'${name}' is not a valid DurableObjectNamespace`)
    }
    return ns as DurableObjectNamespace
  }

  // Create proxy handlers
  const createProxy = new Proxy({} as Record<string, unknown>, {
    get(_, namespace: string) {
      return async (options: CreateOptions & { name?: string }): Promise<CreateResult> => {
        const ns = getNamespace(namespace)

        // Generate name if not provided
        const name = options.name ?? `${namespace.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`

        // Call registry to create entry
        const entry = await callRegistry<RegistryEntry>(
          registry,
          'create',
          namespace,
          name,
          { in: options.in, metadata: options.metadata }
        )

        // Get stub using the registered ID
        const doId = ns.idFromName(entry.id)
        const stub = ns.get(doId)

        return { stub, name, entry }
      }
    },
  })

  const getProxy = new Proxy({} as Record<string, unknown>, {
    get(_, namespace: string) {
      return async (name: string, options?: GetOptions): Promise<GetResult | null> => {
        const ns = getNamespace(namespace)

        // Try cache first
        const snapshot = await getSnapshot(bucket, namespace, cacheTtl)
        let entry = snapshot?.entries.find(e => e.name === name) ?? null
        let cached = !!entry

        // If not in cache or options require fresh data, hit the DO
        if (!entry || options?.in) {
          entry = await callRegistry<RegistryEntry | null>(
            registry,
            'get',
            namespace,
            name,
            options
          )
          cached = false
        }

        if (!entry) return null

        // Check colo constraint
        if (options?.in && entry.colo !== options.in.toUpperCase()) {
          throw new Error(
            `Entry '${name}' exists in ${entry.colo}, not ${options.in.toUpperCase()}`
          )
        }

        // Get stub
        const doId = ns.idFromName(entry.id)
        const stub = ns.get(doId)

        return { stub, entry, cached }
      }
    },
  })

  const getOrCreateProxy = new Proxy({} as Record<string, unknown>, {
    get(_, namespace: string) {
      return async (name: string, options: CreateOptions): Promise<GetResult & { created: boolean }> => {
        const ns = getNamespace(namespace)

        const result = await callRegistry<{ entry: RegistryEntry; created: boolean }>(
          registry,
          'getOrCreate',
          namespace,
          name,
          options
        )

        const doId = ns.idFromName(result.entry.id)
        const stub = ns.get(doId)

        return {
          stub,
          entry: result.entry,
          cached: false,
          created: result.created,
        }
      }
    },
  })

  const listProxy = new Proxy({} as Record<string, unknown>, {
    get(_, namespace: string) {
      return async (options?: { colo?: string; limit?: number; offset?: number }): Promise<RegistryEntry[]> => {
        // Try cache first for unfiltered requests
        if (!options?.colo && !options?.limit && !options?.offset) {
          const snapshot = await getSnapshot(bucket, namespace, cacheTtl)
          if (snapshot) {
            return snapshot.entries
          }
        }

        return callRegistry<RegistryEntry[]>(registry, 'list', namespace, options)
      }
    },
  })

  const deleteProxy = new Proxy({} as Record<string, unknown>, {
    get(_, namespace: string) {
      return async (name: string): Promise<boolean> => {
        // Invalidate cache
        snapshotCache.delete(namespace)

        return callRegistry<boolean>(registry, 'delete', namespace, name)
      }
    },
  })

  const moveProxy = new Proxy({} as Record<string, unknown>, {
    get(_, namespace: string) {
      return async (name: string, options: { to: string }): Promise<GetResult> => {
        const ns = getNamespace(namespace)

        // Invalidate cache
        snapshotCache.delete(namespace)

        const entry = await callRegistry<RegistryEntry>(
          registry,
          'move',
          namespace,
          name,
          options
        )

        const doId = ns.idFromName(entry.id)
        const stub = ns.get(doId)

        return { stub, entry, cached: false }
      }
    },
  })

  const rawProxy = new Proxy({} as Record<string, unknown>, {
    get(_, namespace: string) {
      return getNamespace(namespace)
    },
  })

  return {
    create: createProxy as WrappedEnv['create'],
    get: getProxy as WrappedEnv['get'],
    getOrCreate: getOrCreateProxy as WrappedEnv['getOrCreate'],
    list: listProxy as WrappedEnv['list'],
    delete: deleteProxy as WrappedEnv['delete'],
    move: moveProxy as WrappedEnv['move'],
    raw: rawProxy as WrappedEnv['raw'],
  }
}

/**
 * Invalidate the snapshot cache for a namespace
 * Call this after making changes via the registry
 */
export function invalidateCache(namespace: string): void {
  snapshotCache.delete(namespace)
}

/**
 * Clear the entire snapshot cache
 */
export function clearCache(): void {
  snapshotCache.clear()
}
