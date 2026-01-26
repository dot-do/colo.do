/**
 * FastRegistry - 31x Faster DO ID Resolution
 *
 * Standard idFromName() costs ~157ms (global coordination).
 * FastRegistry stores hex IDs and uses idFromString() for ~5ms (31x faster).
 *
 * ## Architecture
 *
 * ```
 *   Request -> L1 Cache API (SWR) -> L2 Index DO -> L3 idFromName fallback
 *                |                       |                  |
 *             ~1-5ms                 ~5-20ms           ~100-200ms
 *              FREE                 local DO          global coord
 * ```
 *
 * ## Benchmark Results
 *
 * | Method | Latency | Notes |
 * |--------|---------|-------|
 * | idFromName() | ~157ms | Global coordination required |
 * | newUniqueId() | ~56ms | New DO creation |
 * | idFromString() | ~5ms | No coordination, instant |
 *
 * ## Layer Responsibilities
 *
 * **L1 Cache API** - FREE, globally distributed
 * - Cache key: `{prefix}/fast/{namespace}/{name}`
 * - SWR pattern: serve stale, revalidate in background
 * - Default TTL: 30s fresh, 300s stale
 *
 * **L2 Index DO** - Regional, SQLite-backed
 * - Authoritative store for name->hexId mappings
 * - Accessed on L1 cache miss
 * - Populates L1 cache on response
 *
 * **L3 Fallback** - idFromName() as last resort
 * - Used only when entry doesn't exist
 * - Registers new entry in L2 (and L1)
 *
 * @example
 * ```typescript
 * import { createFastRegistry, FastRegistryDO } from 'colo.do'
 *
 * // Export the DO
 * export { FastRegistryDO }
 *
 * export default {
 *   async fetch(request, env, ctx) {
 *     const registry = createFastRegistry(env)
 *
 *     // Fast lookup (~5ms vs ~157ms)
 *     const entry = await registry.lookup('MY_DO', 'user-123', ctx)
 *     if (entry) {
 *       const id = env.MY_DO.idFromString(entry.hexId)
 *       return env.MY_DO.get(id).fetch(request)
 *     }
 *
 *     // Cache miss - fallback to idFromName and register
 *     const id = env.MY_DO.idFromName('user-123')
 *     ctx.waitUntil(registry.register({
 *       namespace: 'MY_DO',
 *       name: 'user-123',
 *       hexId: id.toString(),
 *       locationHint: 'enam',
 *     }))
 *     return env.MY_DO.get(id).fetch(request)
 *   }
 * }
 * ```
 *
 * @module fast-registry
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Entry stored in FastRegistry for each DO instance
 */
export interface FastRegistryEntry {
  /** Logical name (user-provided identifier) */
  name: string
  /** DO ID hex string from id.toString() - used with idFromString() */
  hexId: string
  /** DO class namespace name (e.g., 'MY_DO') */
  namespace: string
  /** Location hint region (enam, weur, apac, etc.) */
  locationHint: string
  /** When this entry was created */
  createdAt: number
  /** When this DO was last accessed */
  lastAccessedAt: number
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Configuration for FastRegistry
 */
export interface FastRegistryConfig {
  /** Cache TTL in seconds (default: 30) */
  cacheTtlSeconds?: number
  /** Stale TTL - how long to serve stale while revalidating (default: 300) */
  staleTtlSeconds?: number
  /** Cache key prefix (must be a valid URL origin) */
  cacheKeyPrefix?: string
  /** Enable access time tracking (default: true) */
  trackAccessTime?: boolean
}

/**
 * Statistics from FastRegistry operations
 */
export interface FastRegistryStats {
  /** Number of L1 cache hits (FREE, ~1-5ms) */
  l1CacheHits: number
  /** Number of L2 index DO hits (~2-3ms) */
  l2IndexHits: number
  /** Number of L3 creation fallbacks (~56ms) */
  l3CreationFallbacks: number
  /** Total number of new registrations */
  registrations: number
  /** Number of pending background revalidations */
  pendingRevalidations: number
  /** Combined hit rate: (l1 + l2) / (l1 + l2 + l3) */
  hitRate: number
}

/**
 * Environment bindings required for FastRegistry
 */
export interface FastRegistryEnv {
  /** The fast registry durable object namespace */
  FAST_REGISTRY_DO?: DurableObjectNamespace
}

// ============================================================================
// Default Configuration
// ============================================================================

/**
 * Default configuration values for FastRegistry.
 *
 * These defaults are optimized for typical DO usage patterns:
 * - 30s fresh cache: Fast enough to catch most repeated lookups
 * - 300s stale TTL: Long enough to survive temporary L2 issues
 * - Access tracking: Enables LRU-style eviction in L2
 */
export const DEFAULT_FAST_REGISTRY_CONFIG: Required<FastRegistryConfig> = {
  cacheTtlSeconds: 30,
  staleTtlSeconds: 300,
  cacheKeyPrefix: 'https://fast-registry.internal',
  trackAccessTime: true,
}

// ============================================================================
// L1 Cache Helpers - FREE Cloudflare Cache API
// ============================================================================

/**
 * Get the Cloudflare Cache API instance.
 *
 * Uses the default cache which is FREE and globally distributed.
 * This is the foundation of the L1 layer.
 *
 * @returns The default Cache instance
 */
export function getCache(): Cache {
  // In Cloudflare Workers, caches.default is the global cache
  // @ts-ignore - caches is a global in Cloudflare Workers
  return caches.default
}

/**
 * Build a cache key URL for a FastRegistry entry.
 *
 * Format: `{prefix}/fast/{namespace}/{name}`
 *
 * The /fast/ path segment distinguishes FastRegistry keys from other
 * cache entries that might use the same prefix.
 *
 * @param prefix - Cache key prefix URL (e.g., 'https://fast-registry.internal')
 * @param namespace - DO class name (e.g., 'POSTGRES_DO')
 * @param name - Logical instance name (e.g., 'my-database')
 * @returns Cache key URL suitable for Cache API operations
 */
export function buildCacheKey(prefix: string, namespace: string, name: string): string {
  return `${prefix}/fast/${namespace}/${encodeURIComponent(name)}`
}

/**
 * Check if a cached response is stale based on Cache-Control headers.
 *
 * A response is stale if its Age exceeds the max-age directive.
 * Stale responses can still be served (SWR pattern) while triggering
 * background revalidation.
 *
 * @param response - The cached Response object
 * @returns true if the response is stale (Age > max-age)
 */
export function isCacheStale(response: Response): boolean {
  const age = response.headers.get('age')
  const cacheControl = response.headers.get('cache-control')

  if (!age || !cacheControl) return false

  const maxAge = cacheControl.match(/max-age=(\d+)/)
  if (!maxAge) return false

  return parseInt(age) > parseInt(maxAge[1])
}

/**
 * Store a FastRegistry entry in the L1 Cache.
 *
 * Sets Cache-Control headers with max-age and stale-while-revalidate
 * for optimal SWR behavior:
 *
 * - `max-age`: How long the entry is considered fresh
 * - `stale-while-revalidate`: How long to serve stale while refreshing
 *
 * @param config - FastRegistry configuration
 * @param entry - The entry to cache
 */
export async function cacheEntry(
  config: FastRegistryConfig,
  entry: FastRegistryEntry
): Promise<void> {
  const cache = getCache()
  const mergedConfig = { ...DEFAULT_FAST_REGISTRY_CONFIG, ...config }
  const cacheKey = buildCacheKey(mergedConfig.cacheKeyPrefix, entry.namespace, entry.name)

  const response = new Response(JSON.stringify(entry), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${mergedConfig.cacheTtlSeconds}, stale-while-revalidate=${mergedConfig.staleTtlSeconds}`,
    },
  })

  await cache.put(cacheKey, response)
}

/**
 * Look up a FastRegistry entry from the L1 Cache.
 *
 * Returns the entry immediately if found (even if stale).
 * For stale entries with an ExecutionContext, background revalidation
 * can be triggered via waitUntil.
 *
 * This is the primary lookup path - it's FREE and globally distributed.
 *
 * @param config - FastRegistry configuration
 * @param namespace - DO class name
 * @param name - Logical instance name
 * @param ctx - Optional ExecutionContext for background revalidation
 * @returns The entry if found, null otherwise
 */
export async function lookupFromCache(
  config: FastRegistryConfig,
  namespace: string,
  name: string,
  ctx?: ExecutionContext
): Promise<FastRegistryEntry | null> {
  const cache = getCache()
  const mergedConfig = { ...DEFAULT_FAST_REGISTRY_CONFIG, ...config }
  const cacheKey = buildCacheKey(mergedConfig.cacheKeyPrefix, namespace, name)

  try {
    const response = await cache.match(cacheKey)

    if (!response) {
      return null
    }

    const entry = await response.json<FastRegistryEntry>()

    // Check if stale and should trigger background revalidation
    // Note: Actual revalidation from L2 will be added when factory is implemented
    if (isCacheStale(response) && ctx) {
      // Background revalidation placeholder
      // ctx.waitUntil(revalidateFromL2(config, namespace, name))
    }

    return entry
  } catch {
    // Cache errors should not block the caller - return null and let
    // the caller fall back to L2 or L3
    return null
  }
}

/**
 * Invalidate a FastRegistry entry from the L1 Cache.
 *
 * Call this when an entry is deleted, moved, or needs to be refreshed.
 * The entry will naturally expire via TTL, but explicit invalidation
 * ensures immediate consistency.
 *
 * @param config - FastRegistry configuration
 * @param namespace - DO class name
 * @param name - Logical instance name
 */
export async function invalidateFastRegistryCache(
  config: FastRegistryConfig,
  namespace: string,
  name: string
): Promise<void> {
  const cache = getCache()
  const mergedConfig = { ...DEFAULT_FAST_REGISTRY_CONFIG, ...config }
  const cacheKey = buildCacheKey(mergedConfig.cacheKeyPrefix, namespace, name)

  try {
    await cache.delete(cacheKey)
  } catch {
    // Cache deletion errors should not propagate
    // The entry will naturally expire via TTL
  }
}

// ============================================================================
// FastRegistryDO - L2 Index DO Storage
// ============================================================================

/**
 * FastRegistryDO - Durable Object for L2 storage
 *
 * Stores name->hexId mappings in SQLite for fast regional lookups.
 * Used when L1 Cache misses.
 *
 * Endpoints:
 * - GET /lookup/{namespace}/{name} - Lookup an entry
 * - POST /register - Register/update an entry
 * - POST /access - Update lastAccessedAt timestamp
 * - GET /stats - Get registry statistics
 *
 * @example
 * ```typescript
 * // In wrangler.toml:
 * [[durable_objects.bindings]]
 * name = "FAST_REGISTRY_DO"
 * class_name = "FastRegistryDO"
 *
 * // Export from worker:
 * export { FastRegistryDO } from 'colo.do'
 * ```
 */
export class FastRegistryDO implements DurableObject {
  private sql: DurableObjectStorage['sql']
  private initialized = false

  constructor(private state: DurableObjectState) {
    this.sql = state.storage.sql
  }

  private ensureInitialized(): void {
    if (this.initialized) return

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS entries (
        namespace TEXT NOT NULL,
        name TEXT NOT NULL,
        hex_id TEXT NOT NULL,
        location_hint TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        metadata TEXT,
        PRIMARY KEY (namespace, name)
      )
    `)

    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_namespace ON entries(namespace)
    `)

    this.initialized = true
  }

  async fetch(request: Request): Promise<Response> {
    this.ensureInitialized()
    const url = new URL(request.url)
    const path = url.pathname

    // GET /lookup/{namespace}/{name}
    if (path.startsWith('/lookup/') && request.method === 'GET') {
      return this.handleLookup(path)
    }

    // POST /register
    if (path === '/register' && request.method === 'POST') {
      const entry = await request.json<FastRegistryEntry>()
      return this.handleRegister(entry)
    }

    // POST /access
    if (path === '/access' && request.method === 'POST') {
      const body = await request.json<{ namespace: string; name: string; accessedAt: number }>()
      return this.handleAccess(body.namespace, body.name, body.accessedAt)
    }

    // GET /stats
    if (path === '/stats' && request.method === 'GET') {
      return this.handleStats()
    }

    return new Response('Not Found', { status: 404 })
  }

  /**
   * Handle GET /lookup/{namespace}/{name}
   *
   * Extracts namespace and name from path and returns the entry if found.
   */
  private handleLookup(path: string): Response {
    // Path format: /lookup/{namespace}/{name}
    const pathParts = path.slice('/lookup/'.length).split('/')
    if (pathParts.length < 2) {
      return new Response('Bad Request: path must be /lookup/{namespace}/{name}', { status: 400 })
    }

    const namespace = decodeURIComponent(pathParts[0])
    const name = decodeURIComponent(pathParts.slice(1).join('/'))

    const result = this.sql.exec<{
      namespace: string
      name: string
      hex_id: string
      location_hint: string
      created_at: number
      last_accessed_at: number
      metadata: string | null
    }>(
      `SELECT namespace, name, hex_id, location_hint, created_at, last_accessed_at, metadata
       FROM entries
       WHERE namespace = ? AND name = ?`,
      namespace,
      name
    )

    const rows = [...result]
    if (rows.length === 0) {
      return new Response('Not Found', { status: 404 })
    }

    const row = rows[0]
    const entry: FastRegistryEntry = {
      namespace: row.namespace,
      name: row.name,
      hexId: row.hex_id,
      locationHint: row.location_hint,
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }

    return Response.json(entry)
  }

  /**
   * Handle POST /register
   *
   * Upserts an entry into the registry.
   */
  private handleRegister(entry: FastRegistryEntry): Response {
    const metadataJson = entry.metadata ? JSON.stringify(entry.metadata) : null

    this.sql.exec(
      `INSERT INTO entries (namespace, name, hex_id, location_hint, created_at, last_accessed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (namespace, name) DO UPDATE SET
         hex_id = excluded.hex_id,
         location_hint = excluded.location_hint,
         last_accessed_at = excluded.last_accessed_at,
         metadata = excluded.metadata`,
      entry.namespace,
      entry.name,
      entry.hexId,
      entry.locationHint,
      entry.createdAt,
      entry.lastAccessedAt,
      metadataJson
    )

    return Response.json({ ok: true })
  }

  /**
   * Handle POST /access
   *
   * Updates the lastAccessedAt timestamp for an entry.
   */
  private handleAccess(namespace: string, name: string, accessedAt: number): Response {
    this.sql.exec(
      `UPDATE entries
       SET last_accessed_at = ?
       WHERE namespace = ? AND name = ?`,
      accessedAt,
      namespace,
      name
    )

    return Response.json({ ok: true })
  }

  /**
   * Handle GET /stats
   *
   * Returns total entry count and counts by namespace.
   */
  private handleStats(): Response {
    // Get total count
    const countResult = this.sql.exec<{ count: number }>(
      `SELECT COUNT(*) as count FROM entries`
    )
    const countRows = [...countResult]
    const totalEntries = countRows[0]?.count ?? 0

    // Get counts by namespace
    const namespaceResult = this.sql.exec<{ namespace: string; count: number }>(
      `SELECT namespace, COUNT(*) as count
       FROM entries
       GROUP BY namespace`
    )
    const byNamespace: Record<string, number> = {}
    for (const row of namespaceResult) {
      byNamespace[row.namespace] = row.count
    }

    return Response.json({
      totalEntries,
      byNamespace,
    })
  }
}
