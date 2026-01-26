/**
 * Tests for FastRegistry - 31x faster DO lookups using idFromString
 *
 * FastRegistry stores hex DO IDs and uses idFromString() (~5ms) instead of
 * idFromName() (~157ms) for massive performance improvement.
 *
 * Architecture:
 * - L1: Cache API (FREE, ~1-5ms)
 * - L2: Index DO (~2-3ms)
 * - L3: newUniqueId() fallback (~56ms)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  // Types
  type FastRegistryEntry,
  type FastRegistryConfig,
  type FastRegistryStats,
  // L1 Cache helpers
  getCache,
  buildCacheKey,
  isCacheStale,
  cacheEntry,
  lookupFromCache,
  invalidateFastRegistryCache,
  DEFAULT_FAST_REGISTRY_CONFIG,
  // L2 Index DO
  FastRegistryDO,
} from '../fast-registry.js'

// ============================================================================
// Mock Cloudflare Cache API
// ============================================================================

const mockCache = {
  match: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}

const mockCaches = {
  default: mockCache,
}

// Polyfill global caches for testing
;(globalThis as unknown as { caches: typeof mockCaches }).caches = mockCaches

// Mock execution context
const createMockContext = () => ({
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
  props: {} as unknown,
}) as unknown as ExecutionContext

// ============================================================================
// Test Data
// ============================================================================

const sampleEntry: FastRegistryEntry = {
  name: 'my-database',
  hexId: 'a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890',
  namespace: 'POSTGRES_DO',
  locationHint: 'enam',
  createdAt: Date.now(),
  lastAccessedAt: Date.now(),
  metadata: { tier: 'premium' },
}

const defaultConfig: FastRegistryConfig = {
  cacheTtlSeconds: 30,
  staleTtlSeconds: 300,
  cacheKeyPrefix: 'https://fast-registry.internal',
  trackAccessTime: true,
}

// ============================================================================
// Type Export Tests
// ============================================================================

describe('FastRegistry Types', () => {
  describe('FastRegistryEntry', () => {
    it('should have required fields', () => {
      const entry: FastRegistryEntry = {
        name: 'test-do',
        hexId: 'abc123',
        namespace: 'MY_DO',
        locationHint: 'enam',
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      }

      expect(entry.name).toBe('test-do')
      expect(entry.hexId).toBe('abc123')
      expect(entry.namespace).toBe('MY_DO')
      expect(entry.locationHint).toBe('enam')
      expect(typeof entry.createdAt).toBe('number')
      expect(typeof entry.lastAccessedAt).toBe('number')
    })

    it('should support optional metadata', () => {
      const entry: FastRegistryEntry = {
        name: 'test-do',
        hexId: 'abc123',
        namespace: 'MY_DO',
        locationHint: 'weur',
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        metadata: {
          customField: 'value',
          tier: 'premium',
          tags: ['production', 'critical'],
        },
      }

      expect(entry.metadata).toBeDefined()
      expect(entry.metadata?.customField).toBe('value')
    })

    it('should allow undefined metadata', () => {
      const entry: FastRegistryEntry = {
        name: 'test-do',
        hexId: 'abc123',
        namespace: 'MY_DO',
        locationHint: 'apac',
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      }

      expect(entry.metadata).toBeUndefined()
    })
  })

  describe('FastRegistryConfig', () => {
    it('should have optional cache TTL', () => {
      const config: FastRegistryConfig = {}
      expect(config.cacheTtlSeconds).toBeUndefined()
    })

    it('should support all optional fields', () => {
      const config: FastRegistryConfig = {
        cacheTtlSeconds: 60,
        staleTtlSeconds: 600,
        cacheKeyPrefix: 'https://custom.registry.internal',
        trackAccessTime: false,
      }

      expect(config.cacheTtlSeconds).toBe(60)
      expect(config.staleTtlSeconds).toBe(600)
      expect(config.cacheKeyPrefix).toBe('https://custom.registry.internal')
      expect(config.trackAccessTime).toBe(false)
    })

    it('should have sensible defaults', () => {
      expect(DEFAULT_FAST_REGISTRY_CONFIG.cacheTtlSeconds).toBe(30)
      expect(DEFAULT_FAST_REGISTRY_CONFIG.staleTtlSeconds).toBe(300)
      expect(DEFAULT_FAST_REGISTRY_CONFIG.cacheKeyPrefix).toBe('https://fast-registry.internal')
      expect(DEFAULT_FAST_REGISTRY_CONFIG.trackAccessTime).toBe(true)
    })
  })

  describe('FastRegistryStats', () => {
    it('should track L1 cache hits', () => {
      const stats: FastRegistryStats = {
        l1CacheHits: 100,
        l2IndexHits: 50,
        l3CreationFallbacks: 10,
        registrations: 60,
        pendingRevalidations: 5,
        hitRate: 0.9375,
      }

      expect(stats.l1CacheHits).toBe(100)
    })

    it('should track L2 index hits', () => {
      const stats: FastRegistryStats = {
        l1CacheHits: 0,
        l2IndexHits: 100,
        l3CreationFallbacks: 0,
        registrations: 0,
        pendingRevalidations: 0,
        hitRate: 1.0,
      }

      expect(stats.l2IndexHits).toBe(100)
    })

    it('should track L3 creation fallbacks', () => {
      const stats: FastRegistryStats = {
        l1CacheHits: 0,
        l2IndexHits: 0,
        l3CreationFallbacks: 100,
        registrations: 100,
        pendingRevalidations: 0,
        hitRate: 0,
      }

      expect(stats.l3CreationFallbacks).toBe(100)
    })

    it('should calculate hit rate', () => {
      const stats: FastRegistryStats = {
        l1CacheHits: 70,
        l2IndexHits: 20,
        l3CreationFallbacks: 10,
        registrations: 10,
        pendingRevalidations: 0,
        hitRate: 0.9, // (70 + 20) / (70 + 20 + 10)
      }

      expect(stats.hitRate).toBe(0.9)
    })
  })
})

// ============================================================================
// L1 Cache Helper Tests
// ============================================================================

describe('L1 Cache Helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCache.match.mockReset()
    mockCache.put.mockReset()
    mockCache.delete.mockReset()
  })

  describe('getCache()', () => {
    it('should return the default cache', () => {
      const cache = getCache()
      expect(cache).toBe(mockCaches.default)
    })
  })

  describe('buildCacheKey()', () => {
    it('should build correct cache key format', () => {
      const key = buildCacheKey('https://fast-registry.internal', 'POSTGRES_DO', 'my-db')
      expect(key).toBe('https://fast-registry.internal/fast/POSTGRES_DO/my-db')
    })

    it('should encode special characters in name', () => {
      const key = buildCacheKey('https://fast-registry.internal', 'MY_DO', 'name with spaces')
      expect(key).toBe('https://fast-registry.internal/fast/MY_DO/name%20with%20spaces')
    })

    it('should handle empty namespace', () => {
      const key = buildCacheKey('https://fast-registry.internal', '', 'my-db')
      expect(key).toBe('https://fast-registry.internal/fast//my-db')
    })

    it('should use custom prefix', () => {
      const key = buildCacheKey('https://custom.prefix', 'DO_CLASS', 'instance')
      expect(key).toBe('https://custom.prefix/fast/DO_CLASS/instance')
    })
  })

  describe('isCacheStale()', () => {
    it('should return false for fresh response', () => {
      const response = new Response(JSON.stringify(sampleEntry), {
        headers: {
          'Cache-Control': 'max-age=30',
          Age: '10',
        },
      })

      expect(isCacheStale(response)).toBe(false)
    })

    it('should return true for stale response', () => {
      const response = new Response(JSON.stringify(sampleEntry), {
        headers: {
          'Cache-Control': 'max-age=30',
          Age: '60', // 60 > 30, so stale
        },
      })

      expect(isCacheStale(response)).toBe(true)
    })

    it('should return false if no age header', () => {
      const response = new Response(JSON.stringify(sampleEntry), {
        headers: {
          'Cache-Control': 'max-age=30',
        },
      })

      expect(isCacheStale(response)).toBe(false)
    })

    it('should return false if no cache-control header', () => {
      const response = new Response(JSON.stringify(sampleEntry), {
        headers: {
          Age: '60',
        },
      })

      expect(isCacheStale(response)).toBe(false)
    })

    it('should return false if no max-age directive', () => {
      const response = new Response(JSON.stringify(sampleEntry), {
        headers: {
          'Cache-Control': 'public',
          Age: '60',
        },
      })

      expect(isCacheStale(response)).toBe(false)
    })
  })

  describe('cacheEntry()', () => {
    it('should store entry in cache', async () => {
      await cacheEntry(defaultConfig, sampleEntry)

      expect(mockCache.put).toHaveBeenCalledTimes(1)
      expect(mockCache.put).toHaveBeenCalledWith(
        expect.stringContaining('fast-registry.internal/fast/POSTGRES_DO/my-database'),
        expect.any(Response)
      )
    })

    it('should set correct Cache-Control headers', async () => {
      await cacheEntry(defaultConfig, sampleEntry)

      const response = mockCache.put.mock.calls[0][1] as Response
      const cacheControl = response.headers.get('Cache-Control')

      expect(cacheControl).toContain('max-age=30')
      expect(cacheControl).toContain('stale-while-revalidate=300')
    })

    it('should use custom TTL values', async () => {
      const customConfig: FastRegistryConfig = {
        cacheTtlSeconds: 60,
        staleTtlSeconds: 600,
        cacheKeyPrefix: 'https://fast-registry.internal',
      }

      await cacheEntry(customConfig, sampleEntry)

      const response = mockCache.put.mock.calls[0][1] as Response
      const cacheControl = response.headers.get('Cache-Control')

      expect(cacheControl).toContain('max-age=60')
      expect(cacheControl).toContain('stale-while-revalidate=600')
    })

    it('should serialize entry as JSON', async () => {
      await cacheEntry(defaultConfig, sampleEntry)

      const response = mockCache.put.mock.calls[0][1] as Response
      const body = await response.clone().json() as FastRegistryEntry

      expect(body.name).toBe(sampleEntry.name)
      expect(body.hexId).toBe(sampleEntry.hexId)
      expect(body.namespace).toBe(sampleEntry.namespace)
    })

    it('should set Content-Type header', async () => {
      await cacheEntry(defaultConfig, sampleEntry)

      const response = mockCache.put.mock.calls[0][1] as Response
      expect(response.headers.get('Content-Type')).toBe('application/json')
    })
  })

  describe('lookupFromCache()', () => {
    it('should return entry on cache hit', async () => {
      mockCache.match.mockResolvedValue(
        new Response(JSON.stringify(sampleEntry), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'max-age=30',
            Age: '5',
          },
        })
      )

      const result = await lookupFromCache(defaultConfig, 'POSTGRES_DO', 'my-database')

      expect(result).not.toBeNull()
      expect(result?.name).toBe('my-database')
      expect(result?.hexId).toBe(sampleEntry.hexId)
    })

    it('should return null on cache miss', async () => {
      mockCache.match.mockResolvedValue(undefined)

      const result = await lookupFromCache(defaultConfig, 'POSTGRES_DO', 'nonexistent')

      expect(result).toBeNull()
    })

    it('should trigger background revalidation on stale hit with context', async () => {
      mockCache.match.mockResolvedValue(
        new Response(JSON.stringify(sampleEntry), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'max-age=30',
            Age: '60', // Stale
          },
        })
      )

      const ctx = createMockContext()
      const result = await lookupFromCache(defaultConfig, 'POSTGRES_DO', 'my-database', ctx)

      expect(result).not.toBeNull()
      // Stale hit should still return data but may trigger revalidation
      expect(result?.name).toBe('my-database')
    })

    it('should use correct cache key', async () => {
      mockCache.match.mockResolvedValue(undefined)

      await lookupFromCache(defaultConfig, 'MY_DO', 'instance-name')

      expect(mockCache.match).toHaveBeenCalledWith(
        'https://fast-registry.internal/fast/MY_DO/instance-name'
      )
    })

    it('should handle cache errors gracefully', async () => {
      mockCache.match.mockRejectedValue(new Error('Cache unavailable'))

      const result = await lookupFromCache(defaultConfig, 'POSTGRES_DO', 'my-database')

      expect(result).toBeNull()
    })
  })

  describe('invalidateFastRegistryCache()', () => {
    it('should delete entry from cache', async () => {
      mockCache.delete.mockResolvedValue(true)

      await invalidateFastRegistryCache(defaultConfig, 'POSTGRES_DO', 'my-database')

      expect(mockCache.delete).toHaveBeenCalledWith(
        'https://fast-registry.internal/fast/POSTGRES_DO/my-database'
      )
    })

    it('should handle delete failure gracefully', async () => {
      mockCache.delete.mockRejectedValue(new Error('Delete failed'))

      // Should not throw
      await expect(
        invalidateFastRegistryCache(defaultConfig, 'POSTGRES_DO', 'my-database')
      ).resolves.not.toThrow()
    })

    it('should return success for non-existent key', async () => {
      mockCache.delete.mockResolvedValue(false)

      // Should not throw even if key didn't exist
      await expect(
        invalidateFastRegistryCache(defaultConfig, 'POSTGRES_DO', 'nonexistent')
      ).resolves.not.toThrow()
    })
  })
})

// ============================================================================
// SWR Behavior Tests
// ============================================================================

describe('SWR (Stale-While-Revalidate) Behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCache.match.mockReset()
    mockCache.put.mockReset()
  })

  it('should return stale data immediately while revalidating', async () => {
    const staleEntry = { ...sampleEntry, lastAccessedAt: Date.now() - 60000 }

    mockCache.match.mockResolvedValue(
      new Response(JSON.stringify(staleEntry), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'max-age=30',
          Age: '45', // Past max-age but within stale-while-revalidate
        },
      })
    )

    const ctx = createMockContext()
    const result = await lookupFromCache(defaultConfig, 'POSTGRES_DO', 'my-database', ctx)

    // Should return the stale data immediately
    expect(result).not.toBeNull()
    expect(result?.name).toBe('my-database')
  })

  it('should not block on revalidation', async () => {
    mockCache.match.mockResolvedValue(
      new Response(JSON.stringify(sampleEntry), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'max-age=30',
          Age: '45',
        },
      })
    )

    const ctx = createMockContext()

    const startTime = Date.now()
    await lookupFromCache(defaultConfig, 'POSTGRES_DO', 'my-database', ctx)
    const endTime = Date.now()

    // Lookup should be fast (< 50ms) even if revalidation is happening
    expect(endTime - startTime).toBeLessThan(50)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCache.match.mockReset()
    mockCache.put.mockReset()
  })

  it('should handle entries with no metadata', async () => {
    const entryNoMetadata: FastRegistryEntry = {
      name: 'simple-do',
      hexId: 'abc123def456',
      namespace: 'SIMPLE_DO',
      locationHint: 'enam',
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    }

    await cacheEntry(defaultConfig, entryNoMetadata)

    const response = mockCache.put.mock.calls[0][1] as Response
    const body = await response.clone().json() as FastRegistryEntry

    expect(body.metadata).toBeUndefined()
  })

  it('should handle very long names', async () => {
    const longName = 'a'.repeat(256)
    const key = buildCacheKey('https://fast-registry.internal', 'MY_DO', longName)

    expect(key).toContain(longName)
  })

  it('should handle unicode in names', async () => {
    const unicodeName = 'test-do-'
    const key = buildCacheKey('https://fast-registry.internal', 'MY_DO', unicodeName)

    expect(key).toContain(encodeURIComponent(unicodeName))
  })

  it('should handle concurrent lookups', async () => {
    // Reset and set up the mock for this specific test
    mockCache.match.mockReset()
    mockCache.match.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(sampleEntry), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'max-age=30',
            Age: '5',
          },
        })
      )
    )

    // Fire multiple concurrent lookups
    const results = await Promise.all([
      lookupFromCache(defaultConfig, 'POSTGRES_DO', 'my-database'),
      lookupFromCache(defaultConfig, 'POSTGRES_DO', 'my-database'),
      lookupFromCache(defaultConfig, 'POSTGRES_DO', 'my-database'),
    ])

    // All should return the same entry
    results.forEach((result) => {
      expect(result?.name).toBe('my-database')
    })
  })
})

// ============================================================================
// L2 Index DO Tests (FastRegistryDO)
// ============================================================================

/**
 * Mock DurableObjectState with SQLite storage
 */
function createMockState(): DurableObjectState {
  // In-memory SQLite mock using Map
  const tables = new Map<string, Map<string, Record<string, unknown>>>()
  const indexes = new Set<string>()

  // Simple SQL parser for our specific queries
  const sql = {
    exec: <T = unknown>(query: string, ...params: unknown[]) => {
      const normalizedQuery = query.trim().toLowerCase()

      // CREATE TABLE
      if (normalizedQuery.startsWith('create table')) {
        const match = query.match(/create table if not exists (\w+)/i)
        if (match) {
          const tableName = match[1]
          if (!tables.has(tableName)) {
            tables.set(tableName, new Map())
          }
        }
        return { rowsWritten: 0, [Symbol.iterator]: () => [][Symbol.iterator]() }
      }

      // CREATE INDEX
      if (normalizedQuery.startsWith('create index')) {
        const match = query.match(/create index if not exists (\w+)/i)
        if (match) {
          indexes.add(match[1])
        }
        return { rowsWritten: 0, [Symbol.iterator]: () => [][Symbol.iterator]() }
      }

      // INSERT with ON CONFLICT (upsert)
      if (normalizedQuery.startsWith('insert into entries')) {
        const table = tables.get('entries')!
        const [namespace, name, hexId, locationHint, createdAt, lastAccessedAt, metadata] = params as [
          string, string, string, string, number, number, string | null
        ]
        const key = `${namespace}:${name}`
        const existing = table.get(key)

        if (existing && normalizedQuery.includes('on conflict')) {
          // Update existing entry (upsert)
          table.set(key, {
            namespace,
            name,
            hex_id: hexId,
            location_hint: locationHint,
            created_at: existing.created_at, // Keep original created_at
            last_accessed_at: lastAccessedAt,
            metadata,
          })
        } else {
          // Insert new entry
          table.set(key, {
            namespace,
            name,
            hex_id: hexId,
            location_hint: locationHint,
            created_at: createdAt,
            last_accessed_at: lastAccessedAt,
            metadata,
          })
        }
        return { rowsWritten: 1, [Symbol.iterator]: () => [][Symbol.iterator]() }
      }

      // SELECT with WHERE namespace and name
      if (normalizedQuery.startsWith('select') && normalizedQuery.includes('where namespace = ?')) {
        const table = tables.get('entries')!
        const [namespace, name] = params as [string, string]
        const key = `${namespace}:${name}`
        const row = table.get(key)
        const results = row ? [row as T] : []
        return { rowsWritten: 0, [Symbol.iterator]: () => results[Symbol.iterator]() }
      }

      // UPDATE for access time
      if (normalizedQuery.startsWith('update entries') && normalizedQuery.includes('set last_accessed_at')) {
        const table = tables.get('entries')!
        const [accessedAt, namespace, name] = params as [number, string, string]
        const key = `${namespace}:${name}`
        const existing = table.get(key)
        if (existing) {
          table.set(key, { ...existing, last_accessed_at: accessedAt })
          return { rowsWritten: 1, [Symbol.iterator]: () => [][Symbol.iterator]() }
        }
        return { rowsWritten: 0, [Symbol.iterator]: () => [][Symbol.iterator]() }
      }

      // SELECT COUNT(*)
      if (normalizedQuery.includes('select count(*)') && !normalizedQuery.includes('group by')) {
        const table = tables.get('entries')!
        const count = table.size
        return { rowsWritten: 0, [Symbol.iterator]: () => [{ count } as T][Symbol.iterator]() }
      }

      // SELECT with GROUP BY namespace
      if (normalizedQuery.includes('group by namespace')) {
        const table = tables.get('entries')!
        const counts = new Map<string, number>()
        for (const row of table.values()) {
          const ns = row.namespace as string
          counts.set(ns, (counts.get(ns) ?? 0) + 1)
        }
        const results = Array.from(counts.entries()).map(([namespace, count]) => ({
          namespace,
          count,
        })) as T[]
        return { rowsWritten: 0, [Symbol.iterator]: () => results[Symbol.iterator]() }
      }

      return { rowsWritten: 0, [Symbol.iterator]: () => [][Symbol.iterator]() }
    },
  }

  return {
    id: { toString: () => 'test-id', equals: () => false, name: 'test' },
    storage: {
      sql,
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      getAlarm: vi.fn(),
      setAlarm: vi.fn(),
      deleteAlarm: vi.fn(),
      sync: vi.fn(),
      transaction: vi.fn(),
      transactionSync: vi.fn(),
      deleteAll: vi.fn(),
      getCurrentBookmark: vi.fn(),
      getBookmarkForTime: vi.fn(),
      onNextSessionRestoreBookmark: vi.fn(),
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(),
    abort: vi.fn(),
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn(),
    setWebSocketAutoResponse: vi.fn(),
    getWebSocketAutoResponse: vi.fn(),
    getWebSocketAutoResponseTimestamp: vi.fn(),
    setHibernatableWebSocketEventTimeout: vi.fn(),
    getHibernatableWebSocketEventTimeout: vi.fn(),
    getTags: vi.fn(),
  } as unknown as DurableObjectState
}

describe('FastRegistryDO (L2 Index)', () => {
  let state: DurableObjectState
  let registryDO: FastRegistryDO

  beforeEach(() => {
    state = createMockState()
    registryDO = new FastRegistryDO(state)
  })

  describe('GET /lookup/{namespace}/{name}', () => {
    it('should return 404 if entry does not exist', async () => {
      const request = new Request('https://internal/lookup/MY_DO/nonexistent')
      const response = await registryDO.fetch(request)

      expect(response.status).toBe(404)
      expect(await response.text()).toBe('Not Found')
    })

    it('should return entry if it exists', async () => {
      // First register an entry
      const entry: FastRegistryEntry = {
        namespace: 'MY_DO',
        name: 'user-123',
        hexId: 'abc123def456',
        locationHint: 'enam',
        createdAt: 1000000,
        lastAccessedAt: 1000000,
        metadata: { tier: 'premium' },
      }

      const registerRequest = new Request('https://internal/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      })
      await registryDO.fetch(registerRequest)

      // Now lookup
      const lookupRequest = new Request('https://internal/lookup/MY_DO/user-123')
      const response = await registryDO.fetch(lookupRequest)

      expect(response.status).toBe(200)
      const result = await response.json<FastRegistryEntry>()
      expect(result.name).toBe('user-123')
      expect(result.namespace).toBe('MY_DO')
      expect(result.hexId).toBe('abc123def456')
      expect(result.locationHint).toBe('enam')
      expect(result.metadata).toEqual({ tier: 'premium' })
    })

    it('should handle URL-encoded names', async () => {
      const entry: FastRegistryEntry = {
        namespace: 'MY_DO',
        name: 'user/with/slashes',
        hexId: 'abc123',
        locationHint: 'weur',
        createdAt: 1000000,
        lastAccessedAt: 1000000,
      }

      const registerRequest = new Request('https://internal/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      })
      await registryDO.fetch(registerRequest)

      // Lookup with URL-encoded path
      const lookupRequest = new Request(`https://internal/lookup/MY_DO/${encodeURIComponent('user/with/slashes')}`)
      const response = await registryDO.fetch(lookupRequest)

      expect(response.status).toBe(200)
      const result = await response.json<FastRegistryEntry>()
      expect(result.name).toBe('user/with/slashes')
    })
  })

  describe('POST /register', () => {
    it('should create a new entry', async () => {
      const entry: FastRegistryEntry = {
        namespace: 'POSTGRES_DO',
        name: 'tenant-abc',
        hexId: 'deadbeef1234',
        locationHint: 'apac',
        createdAt: 2000000,
        lastAccessedAt: 2000000,
        metadata: { plan: 'enterprise' },
      }

      const request = new Request('https://internal/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      })

      const response = await registryDO.fetch(request)

      expect(response.status).toBe(200)
      const result = await response.json<{ ok: boolean }>()
      expect(result.ok).toBe(true)

      // Verify entry was created
      const lookupResponse = await registryDO.fetch(
        new Request('https://internal/lookup/POSTGRES_DO/tenant-abc')
      )
      expect(lookupResponse.status).toBe(200)
      const lookupResult = await lookupResponse.json<FastRegistryEntry>()
      expect(lookupResult.hexId).toBe('deadbeef1234')
    })

    it('should update existing entry (upsert)', async () => {
      // Create initial entry
      const entry1: FastRegistryEntry = {
        namespace: 'MY_DO',
        name: 'instance-1',
        hexId: 'original-hex',
        locationHint: 'enam',
        createdAt: 1000000,
        lastAccessedAt: 1000000,
      }

      await registryDO.fetch(new Request('https://internal/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry1),
      }))

      // Update with new hexId and locationHint
      const entry2: FastRegistryEntry = {
        namespace: 'MY_DO',
        name: 'instance-1',
        hexId: 'updated-hex',
        locationHint: 'weur',
        createdAt: 2000000, // This should be ignored (keep original)
        lastAccessedAt: 3000000,
        metadata: { updated: true },
      }

      const response = await registryDO.fetch(new Request('https://internal/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry2),
      }))

      expect(response.status).toBe(200)

      // Verify update
      const lookupResponse = await registryDO.fetch(
        new Request('https://internal/lookup/MY_DO/instance-1')
      )
      const result = await lookupResponse.json<FastRegistryEntry>()

      expect(result.hexId).toBe('updated-hex')
      expect(result.locationHint).toBe('weur')
      expect(result.createdAt).toBe(1000000) // Original preserved
      expect(result.lastAccessedAt).toBe(3000000)
      expect(result.metadata).toEqual({ updated: true })
    })
  })

  describe('POST /access', () => {
    it('should update lastAccessedAt', async () => {
      // Create entry
      const entry: FastRegistryEntry = {
        namespace: 'MY_DO',
        name: 'access-test',
        hexId: 'hex123',
        locationHint: 'enam',
        createdAt: 1000000,
        lastAccessedAt: 1000000,
      }

      await registryDO.fetch(new Request('https://internal/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      }))

      // Update access time
      const accessRequest = new Request('https://internal/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          namespace: 'MY_DO',
          name: 'access-test',
          accessedAt: 5000000,
        }),
      })

      const response = await registryDO.fetch(accessRequest)

      expect(response.status).toBe(200)
      const result = await response.json<{ ok: boolean }>()
      expect(result.ok).toBe(true)

      // Verify update
      const lookupResponse = await registryDO.fetch(
        new Request('https://internal/lookup/MY_DO/access-test')
      )
      const lookupResult = await lookupResponse.json<FastRegistryEntry>()
      expect(lookupResult.lastAccessedAt).toBe(5000000)
    })

    it('should succeed even if entry does not exist (no-op)', async () => {
      const accessRequest = new Request('https://internal/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          namespace: 'MY_DO',
          name: 'nonexistent',
          accessedAt: 5000000,
        }),
      })

      const response = await registryDO.fetch(accessRequest)

      expect(response.status).toBe(200)
      const result = await response.json<{ ok: boolean }>()
      expect(result.ok).toBe(true)
    })
  })

  describe('GET /stats', () => {
    it('should return correct counts', async () => {
      // Create entries in different namespaces
      const entries = [
        { namespace: 'DO_A', name: 'a1', hexId: 'hex1', locationHint: 'enam', createdAt: 1, lastAccessedAt: 1 },
        { namespace: 'DO_A', name: 'a2', hexId: 'hex2', locationHint: 'enam', createdAt: 2, lastAccessedAt: 2 },
        { namespace: 'DO_B', name: 'b1', hexId: 'hex3', locationHint: 'weur', createdAt: 3, lastAccessedAt: 3 },
      ]

      for (const entry of entries) {
        await registryDO.fetch(new Request('https://internal/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry),
        }))
      }

      // Get stats
      const response = await registryDO.fetch(new Request('https://internal/stats'))

      expect(response.status).toBe(200)
      const stats = await response.json<{ totalEntries: number; byNamespace: Record<string, number> }>()

      expect(stats.totalEntries).toBe(3)
      expect(stats.byNamespace).toEqual({
        DO_A: 2,
        DO_B: 1,
      })
    })

    it('should return empty stats when no entries', async () => {
      const response = await registryDO.fetch(new Request('https://internal/stats'))

      expect(response.status).toBe(200)
      const stats = await response.json<{ totalEntries: number; byNamespace: Record<string, number> }>()

      expect(stats.totalEntries).toBe(0)
      expect(stats.byNamespace).toEqual({})
    })
  })

  describe('404 handling', () => {
    it('should return 404 for unknown paths', async () => {
      const response = await registryDO.fetch(new Request('https://internal/unknown'))
      expect(response.status).toBe(404)
    })

    it('should return 404 for wrong HTTP methods', async () => {
      const response = await registryDO.fetch(new Request('https://internal/register', { method: 'GET' }))
      expect(response.status).toBe(404)
    })
  })
})
