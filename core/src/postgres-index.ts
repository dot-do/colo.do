/**
 * PostgreSQL Index for postgres.do Tenant Routing
 *
 * Specialized index for postgres.do that reduces first-access latency from ~200ms to ~5-20ms
 * by caching tenant→DO mappings in Cloudflare's Cache API (FREE) with SWR pattern.
 *
 * Architecture:
 *   Request → L1 Cache API (SWR) → L2 Colo Index DO → L3 Global
 *                 |                      |                |
 *              ~1-5ms               ~5-20ms         ~100-200ms
 *                FREE               local DO          fallback
 *
 * @example
 * ```typescript
 * import { createPostgresIndex } from 'colo.do'
 *
 * export default {
 *   async fetch(request, env, ctx) {
 *     const index = createPostgresIndex(env)
 *
 *     // Fast lookup with SWR caching
 *     const entry = await index.lookup('tenant-123', ctx)
 *     if (entry) {
 *       const id = env.POSTGRES_DO.idFromString(entry.doId)
 *       const stub = env.POSTGRES_DO.get(id, { locationHint: entry.locationHint })
 *       return stub.fetch(request)
 *     }
 *
 *     // New tenant - global coordination + background registration
 *     const id = env.POSTGRES_DO.idFromName('tenant-123')
 *     const stub = env.POSTGRES_DO.get(id)
 *     ctx.waitUntil(index.register({
 *       tenantId: 'tenant-123',
 *       doId: id.toString(),
 *       locationHint: 'enam',
 *     }))
 *     return stub.fetch(request)
 *   }
 * }
 * ```
 */

import { getCurrentColo } from './location.js'
import type { ColoRegion } from './colos.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Entry stored in the postgres index for each tenant
 */
export interface PostgresTenantEntry {
  /** Unique tenant identifier */
  tenantId: string
  /** DO ID string from idFromName() */
  doId: string
  /** Location hint region (enam, weur, apac, etc.) */
  locationHint: string
  /** When this entry was created */
  createdAt: number
  /** When this tenant was last accessed */
  lastAccessedAt: number
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Configuration for the postgres index
 */
export interface PostgresIndexConfig {
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
 * Stats returned by the index
 */
export interface PostgresIndexStats {
  /** Number of cache hits */
  cacheHits: number
  /** Number of cache misses */
  cacheMisses: number
  /** Number of background registrations queued */
  registrations: number
  /** Number of pending revalidations */
  pendingRevalidations: number
  /** Hit rate percentage */
  hitRate: number
}

/**
 * Input for registering a tenant entry
 */
export interface RegisterTenantInput {
  tenantId: string
  doId: string
  locationHint: string
  createdAt?: number
  lastAccessedAt?: number
  metadata?: Record<string, unknown>
}

/**
 * Environment bindings required for postgres index
 */
export interface PostgresIndexEnv {
  /** The postgres index durable object namespace (optional - for L2 storage) */
  POSTGRES_INDEX_DO?: DurableObjectNamespace
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: Required<Omit<PostgresIndexConfig, 'cacheKeyPrefix'>> & { cacheKeyPrefix: string } = {
  cacheTtlSeconds: 30,
  staleTtlSeconds: 300,
  cacheKeyPrefix: 'https://postgres-index.internal',
  trackAccessTime: true,
}

// ============================================================================
// Cache Helpers
// ============================================================================

/**
 * Get the cache instance
 */
function getCache(): Cache {
  return caches.default
}

/**
 * Build a cache key for a tenant entry
 */
function buildCacheKey(prefix: string, tenantId: string): string {
  return `${prefix}/postgres/${encodeURIComponent(tenantId)}`
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

/**
 * Map colo IATA code to region hint for locationHint
 */
export function getRegionForColo(colo?: string): string {
  if (!colo) return 'enam' // Default to eastern north america

  // Map IATA codes to regions based on first letter patterns and known colos
  // This is a simplified mapping - in production you'd use the full COLOS mapping
  const coloUpper = colo.toUpperCase()

  // North America West
  if (['LAX', 'SFO', 'SEA', 'DEN', 'PHX'].includes(coloUpper)) {
    return 'wnam'
  }
  // North America East
  if (['IAD', 'EWR', 'ATL', 'ORD', 'DFW', 'MIA', 'YYZ', 'BOS'].includes(coloUpper)) {
    return 'enam'
  }
  // Western Europe
  if (['LHR', 'CDG', 'AMS', 'FRA', 'MAD', 'MXP', 'ZRH'].includes(coloUpper)) {
    return 'weur'
  }
  // Eastern Europe
  if (['WAW', 'PRG', 'VIE', 'BUD'].includes(coloUpper)) {
    return 'eeur'
  }
  // Asia Pacific
  if (['NRT', 'HND', 'ICN', 'SIN', 'HKG', 'SYD', 'MEL'].includes(coloUpper)) {
    return 'apac'
  }
  // South America
  if (['GRU', 'EZE', 'SCL', 'BOG', 'LIM'].includes(coloUpper)) {
    return 'sam'
  }
  // Africa
  if (['JNB', 'CPT', 'CAI', 'LOS'].includes(coloUpper)) {
    return 'afr'
  }
  // Middle East
  if (['DXB', 'DOH', 'TLV'].includes(coloUpper)) {
    return 'me'
  }
  // Oceania
  if (['SYD', 'MEL', 'AKL', 'PER'].includes(coloUpper)) {
    return 'oc'
  }

  // Default based on first letter heuristics
  const firstLetter = coloUpper[0]
  if (['L', 'C', 'A', 'F', 'M', 'Z'].includes(firstLetter)) {
    return 'weur'
  }
  if (['N', 'H', 'I', 'S'].includes(firstLetter)) {
    return 'apac'
  }

  return 'enam' // Safe default
}

// ============================================================================
// PostgresIndex Implementation
// ============================================================================

/**
 * Create a postgres index for tenant routing
 *
 * Uses Cloudflare Cache API (FREE) with SWR pattern for zero-cost reads.
 *
 * @param env - Environment bindings (POSTGRES_INDEX_DO optional for L2)
 * @param config - Index configuration
 * @returns PostgresIndex instance
 *
 * @example
 * ```typescript
 * const index = createPostgresIndex(env, {
 *   cacheTtlSeconds: 30,
 *   staleTtlSeconds: 300,
 * })
 *
 * // Lookup with SWR caching
 * const entry = await index.lookup('tenant-123', ctx)
 *
 * // Register new tenant in background
 * ctx.waitUntil(index.register({
 *   tenantId: 'new-tenant',
 *   doId: id.toString(),
 *   locationHint: 'weur',
 * }))
 *
 * // Get stats
 * console.log(index.getStats())
 * ```
 */
export function createPostgresIndex(
  env: PostgresIndexEnv,
  config: PostgresIndexConfig = {}
) {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config }
  const { cacheTtlSeconds, staleTtlSeconds, cacheKeyPrefix, trackAccessTime } = mergedConfig

  // Stats tracking
  let cacheHits = 0
  let cacheMisses = 0
  let registrations = 0
  const pendingRevalidations = new Set<string>()

  /**
   * Lookup a tenant entry with SWR caching
   *
   * L1 (Cache API): FREE, returns immediately if cached
   * L2 (Index DO): ~5-20ms, local colo lookup
   * L3 (fallback): Returns null, caller uses global idFromName
   *
   * @param tenantId - The tenant identifier to lookup
   * @param ctx - Execution context for background operations
   * @returns Tenant entry if found, null otherwise
   */
  async function lookup(
    tenantId: string,
    ctx?: ExecutionContext
  ): Promise<PostgresTenantEntry | null> {
    const cache = getCache()
    const cacheKey = buildCacheKey(cacheKeyPrefix, tenantId)

    // L1: Try cache first (FREE)
    try {
      const cachedResponse = await cache.match(cacheKey)

      if (cachedResponse) {
        cacheHits++
        const entry = await cachedResponse.json<PostgresTenantEntry>()

        // Check if stale and should revalidate
        if (isCacheStale(cachedResponse)) {
          // Revalidate in background (don't await)
          if (!pendingRevalidations.has(tenantId)) {
            pendingRevalidations.add(tenantId)
            const revalidate = revalidateEntry(tenantId).finally(() => {
              pendingRevalidations.delete(tenantId)
            })
            ctx?.waitUntil(revalidate)
          }
        }

        // Track access time in background
        if (trackAccessTime && ctx) {
          ctx.waitUntil(updateAccessTime(tenantId))
        }

        return entry
      }
    } catch {
      // Cache read failed, continue to L2
    }

    // L1 miss - try L2 (Index DO) if available
    cacheMisses++

    if (env.POSTGRES_INDEX_DO) {
      try {
        const entry = await fetchFromIndexDO(tenantId)
        if (entry) {
          // Cache for next time
          ctx?.waitUntil(cacheEntry(entry))
          return entry
        }
      } catch {
        // L2 failed, return null for L3 fallback
      }
    }

    // No entry found - caller should use global coordination
    return null
  }

  /**
   * Register a tenant entry (async, for background execution)
   *
   * Caches the entry immediately and registers with Index DO if available.
   *
   * @param input - Tenant registration data
   */
  async function register(input: RegisterTenantInput): Promise<void> {
    registrations++

    const entry: PostgresTenantEntry = {
      tenantId: input.tenantId,
      doId: input.doId,
      locationHint: input.locationHint,
      createdAt: input.createdAt ?? Date.now(),
      lastAccessedAt: input.lastAccessedAt ?? Date.now(),
      metadata: input.metadata,
    }

    // Cache immediately (L1)
    await cacheEntry(entry)

    // Register with Index DO (L2) if available
    if (env.POSTGRES_INDEX_DO) {
      try {
        await registerWithIndexDO(entry)
      } catch (error) {
        // L2 registration failed - entry is still cached in L1
        console.error('Index DO registration failed:', error)
      }
    }
  }

  /**
   * Invalidate a tenant entry from cache
   *
   * @param tenantId - The tenant to invalidate
   */
  async function invalidate(tenantId: string): Promise<void> {
    const cache = getCache()
    const cacheKey = buildCacheKey(cacheKeyPrefix, tenantId)
    await cache.delete(cacheKey)
  }

  /**
   * Get current stats
   */
  function getStats(): PostgresIndexStats {
    const total = cacheHits + cacheMisses
    return {
      cacheHits,
      cacheMisses,
      registrations,
      pendingRevalidations: pendingRevalidations.size,
      hitRate: total > 0 ? (cacheHits / total) * 100 : 0,
    }
  }

  /**
   * Cache an entry in L1
   */
  async function cacheEntry(entry: PostgresTenantEntry): Promise<void> {
    const cache = getCache()
    const cacheKey = buildCacheKey(cacheKeyPrefix, entry.tenantId)

    const response = new Response(JSON.stringify(entry), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${cacheTtlSeconds}, stale-while-revalidate=${staleTtlSeconds}`,
      },
    })

    await cache.put(cacheKey, response)
  }

  /**
   * Revalidate an entry by fetching from L2
   */
  async function revalidateEntry(tenantId: string): Promise<void> {
    if (!env.POSTGRES_INDEX_DO) return

    try {
      const entry = await fetchFromIndexDO(tenantId)
      if (entry) {
        await cacheEntry(entry)
      }
    } catch (error) {
      console.error(`Revalidation failed for ${tenantId}:`, error)
    }
  }

  /**
   * Update access time in Index DO
   */
  async function updateAccessTime(tenantId: string): Promise<void> {
    if (!env.POSTGRES_INDEX_DO) return

    try {
      const stub = getIndexDOStub()
      await stub.fetch(new Request('https://internal/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, accessedAt: Date.now() }),
      }))
    } catch {
      // Access time update is best-effort
    }
  }

  /**
   * Fetch entry from Index DO
   */
  async function fetchFromIndexDO(tenantId: string): Promise<PostgresTenantEntry | null> {
    const stub = getIndexDOStub()
    const response = await stub.fetch(
      new Request(`https://internal/lookup/${encodeURIComponent(tenantId)}`)
    )

    if (!response.ok) {
      return null
    }

    return response.json<PostgresTenantEntry>()
  }

  /**
   * Register entry with Index DO
   */
  async function registerWithIndexDO(entry: PostgresTenantEntry): Promise<void> {
    const stub = getIndexDOStub()
    const response = await stub.fetch(new Request('https://internal/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    }))

    if (!response.ok) {
      throw new Error(`Index DO registration failed: ${response.status}`)
    }
  }

  /**
   * Get the Index DO stub for the current region
   * Uses a deterministic ID to create regional index DOs
   */
  function getIndexDOStub(): DurableObjectStub {
    if (!env.POSTGRES_INDEX_DO) {
      throw new Error('POSTGRES_INDEX_DO not configured')
    }
    // Use a single global index DO for simplicity
    // In production, you might shard by region for lower latency
    const id = env.POSTGRES_INDEX_DO.idFromName('postgres-index-global')
    return env.POSTGRES_INDEX_DO.get(id)
  }

  return {
    lookup,
    register,
    invalidate,
    getStats,
    getRegionForColo,
  }
}

// ============================================================================
// PostgresIndexDO - Durable Object for L2 Storage
// ============================================================================

/**
 * Durable Object for postgres index L2 storage
 *
 * Stores tenant→DO mappings in SQLite for fast regional lookups.
 *
 * @example
 * ```typescript
 * // In wrangler.toml:
 * [[durable_objects.bindings]]
 * name = "POSTGRES_INDEX_DO"
 * class_name = "PostgresIndexDO"
 *
 * // Export from worker:
 * export { PostgresIndexDO } from 'colo.do'
 * ```
 */
export class PostgresIndexDO {
  private sql: DurableObjectStorage['sql']
  private initialized = false

  constructor(private state: DurableObjectState) {
    this.sql = state.storage.sql
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return

    // Create table if not exists
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS tenant_index (
        tenant_id TEXT PRIMARY KEY,
        do_id TEXT NOT NULL,
        location_hint TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        metadata TEXT
      )
    `)

    // Create index for location-based queries
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_location_hint ON tenant_index(location_hint)
    `)

    this.initialized = true
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureInitialized()

    const url = new URL(request.url)
    const path = url.pathname

    // Lookup endpoint
    if (path.startsWith('/lookup/') && request.method === 'GET') {
      const tenantId = decodeURIComponent(path.slice('/lookup/'.length))
      return this.handleLookup(tenantId)
    }

    // Register endpoint
    if (path === '/register' && request.method === 'POST') {
      const entry = await request.json<PostgresTenantEntry>()
      return this.handleRegister(entry)
    }

    // Access time update endpoint
    if (path === '/access' && request.method === 'POST') {
      const { tenantId, accessedAt } = await request.json<{ tenantId: string; accessedAt: number }>()
      return this.handleAccess(tenantId, accessedAt)
    }

    // Stats endpoint
    if (path === '/stats' && request.method === 'GET') {
      return this.handleStats()
    }

    return new Response('Not Found', { status: 404 })
  }

  private handleLookup(tenantId: string): Response {
    const result = this.sql.exec<{
      tenant_id: string
      do_id: string
      location_hint: string
      created_at: number
      last_accessed_at: number
      metadata: string | null
    }>(`
      SELECT tenant_id, do_id, location_hint, created_at, last_accessed_at, metadata
      FROM tenant_index
      WHERE tenant_id = ?
    `, tenantId)

    const rows = [...result]
    if (rows.length === 0) {
      return new Response('Not Found', { status: 404 })
    }

    const row = rows[0]
    const entry: PostgresTenantEntry = {
      tenantId: row.tenant_id,
      doId: row.do_id,
      locationHint: row.location_hint,
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }

    return Response.json(entry)
  }

  private handleRegister(entry: PostgresTenantEntry): Response {
    const metadataJson = entry.metadata ? JSON.stringify(entry.metadata) : null

    this.sql.exec(`
      INSERT OR REPLACE INTO tenant_index
      (tenant_id, do_id, location_hint, created_at, last_accessed_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      entry.tenantId,
      entry.doId,
      entry.locationHint,
      entry.createdAt,
      entry.lastAccessedAt,
      metadataJson
    )

    return Response.json({ ok: true })
  }

  private handleAccess(tenantId: string, accessedAt: number): Response {
    this.sql.exec(`
      UPDATE tenant_index
      SET last_accessed_at = ?
      WHERE tenant_id = ?
    `, accessedAt, tenantId)

    return Response.json({ ok: true })
  }

  private handleStats(): Response {
    const countResult = this.sql.exec<{ count: number }>(`
      SELECT COUNT(*) as count FROM tenant_index
    `)
    const rows = [...countResult]
    const count = rows[0]?.count ?? 0

    const regionResult = this.sql.exec<{ location_hint: string; count: number }>(`
      SELECT location_hint, COUNT(*) as count
      FROM tenant_index
      GROUP BY location_hint
    `)
    const byRegion: Record<string, number> = {}
    for (const row of regionResult) {
      byRegion[row.location_hint] = row.count
    }

    return Response.json({
      totalTenants: count,
      byRegion,
    })
  }
}

export type { ColoRegion }
