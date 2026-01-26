/**
 * DORegistry Workers Tests - Real Durable Objects
 *
 * Tests using vitest-pool-workers with actual Cloudflare Workers runtime.
 * No mocks - tests run against real DO instances with real SQLite storage.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env, SELF } from 'cloudflare:test'
import {
  type DORegistryEntry,
  type DORegistryConfig,
  type DORegistry,
  createDORegistry,
  getCache,
  buildCacheKey,
  isCacheStale,
  cacheEntry,
  lookupFromCache,
  invalidateDORegistryCache,
  DEFAULT_FAST_REGISTRY_CONFIG,
  DORegistryDO,
} from '../do-registry'

// ============================================================================
// Test Data
// ============================================================================

const sampleEntry: DORegistryEntry = {
  name: 'my-database',
  id: 'a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890',
  namespace: 'POSTGRES_DO',
  colo: 'IAD',
  createdAt: Date.now(),
  lastAccessedAt: Date.now(),
  metadata: { tier: 'premium' },
}

const defaultConfig: DORegistryConfig = {
  cacheTtlSeconds: 30,
  staleTtlSeconds: 300,
  cacheKeyPrefix: 'https://fast-registry.internal',
  trackAccessTime: true,
}

// ============================================================================
// Type Export Tests
// ============================================================================

describe('DORegistry Types', () => {
  describe('DORegistryEntry', () => {
    it('should have required fields', () => {
      const entry: DORegistryEntry = {
        name: 'test-do',
        id: 'abc123',
        namespace: 'MY_DO',
        colo: 'IAD',
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      }

      expect(entry.name).toBe('test-do')
      expect(entry.id).toBe('abc123')
      expect(entry.namespace).toBe('MY_DO')
      expect(entry.colo).toBe('IAD')
      expect(typeof entry.createdAt).toBe('number')
      expect(typeof entry.lastAccessedAt).toBe('number')
    })

    it('should support optional metadata', () => {
      const entry: DORegistryEntry = {
        name: 'test-do',
        id: 'abc123',
        namespace: 'MY_DO',
        colo: 'IAD',
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        metadata: { key: 'value' },
      }

      expect(entry.metadata).toEqual({ key: 'value' })
    })

    it('should support optional locationHint', () => {
      const entry: DORegistryEntry = {
        name: 'test-do',
        id: 'abc123',
        namespace: 'MY_DO',
        colo: 'IAD',
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        locationHint: 'enam',
      }

      expect(entry.locationHint).toBe('enam')
    })
  })

  describe('DORegistryConfig', () => {
    it('should have optional cache settings', () => {
      const config: DORegistryConfig = {
        cacheTtlSeconds: 60,
        staleTtlSeconds: 600,
      }

      expect(config.cacheTtlSeconds).toBe(60)
      expect(config.staleTtlSeconds).toBe(600)
    })

    it('should have optional cache key prefix', () => {
      const config: DORegistryConfig = {
        cacheKeyPrefix: 'https://my-cache.internal',
      }

      expect(config.cacheKeyPrefix).toBe('https://my-cache.internal')
    })
  })

  describe('DEFAULT_FAST_REGISTRY_CONFIG', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_FAST_REGISTRY_CONFIG.cacheTtlSeconds).toBe(30)
      expect(DEFAULT_FAST_REGISTRY_CONFIG.staleTtlSeconds).toBe(300)
      expect(DEFAULT_FAST_REGISTRY_CONFIG.cacheKeyPrefix).toBe('https://fast-registry.internal')
      expect(DEFAULT_FAST_REGISTRY_CONFIG.trackAccessTime).toBe(true)
    })
  })
})

// ============================================================================
// L1 Cache API Tests
// ============================================================================

describe('L1 Cache API', () => {
  describe('getCache', () => {
    it('should return the default cache', () => {
      const cache = getCache()
      expect(cache).toBeDefined()
      expect(typeof cache.match).toBe('function')
      expect(typeof cache.put).toBe('function')
      expect(typeof cache.delete).toBe('function')
    })
  })

  describe('buildCacheKey', () => {
    it('should build correct cache key format', () => {
      const key = buildCacheKey('https://test.internal', 'MY_DO', 'user-123')
      expect(key).toBe('https://test.internal/fast/MY_DO/user-123')
    })

    it('should URL-encode special characters in name', () => {
      const key = buildCacheKey('https://test.internal', 'MY_DO', 'user/with/slashes')
      expect(key).toBe('https://test.internal/fast/MY_DO/user%2Fwith%2Fslashes')
    })

    it('should handle spaces in name', () => {
      const key = buildCacheKey('https://test.internal', 'MY_DO', 'user with spaces')
      expect(key).toBe('https://test.internal/fast/MY_DO/user%20with%20spaces')
    })
  })

  describe('isCacheStale', () => {
    it('should return false when no age header', () => {
      const response = new Response('test', {
        headers: { 'Cache-Control': 'max-age=30' },
      })
      expect(isCacheStale(response)).toBe(false)
    })

    it('should return false when no cache-control header', () => {
      const response = new Response('test', {
        headers: { age: '10' },
      })
      expect(isCacheStale(response)).toBe(false)
    })

    it('should return false when age is less than max-age', () => {
      const response = new Response('test', {
        headers: {
          'Cache-Control': 'max-age=30',
          age: '10',
        },
      })
      expect(isCacheStale(response)).toBe(false)
    })

    it('should return true when age exceeds max-age', () => {
      const response = new Response('test', {
        headers: {
          'Cache-Control': 'max-age=30',
          age: '40',
        },
      })
      expect(isCacheStale(response)).toBe(true)
    })
  })

  describe('cacheEntry', () => {
    it('should cache entry with correct headers', async () => {
      const entry = { ...sampleEntry, name: `cache-test-${Date.now()}` }
      await cacheEntry(defaultConfig, entry)

      // Verify by looking up
      const cached = await lookupFromCache(defaultConfig, entry.namespace, entry.name)
      expect(cached).not.toBeNull()
      expect(cached?.id).toBe(entry.id)
    })
  })

  describe('lookupFromCache', () => {
    it('should return null for non-existent entry', async () => {
      const result = await lookupFromCache(defaultConfig, 'MY_DO', 'nonexistent-entry')
      expect(result).toBeNull()
    })

    it('should return cached entry', async () => {
      const entry = { ...sampleEntry, name: `lookup-test-${Date.now()}` }
      await cacheEntry(defaultConfig, entry)

      const cached = await lookupFromCache(defaultConfig, entry.namespace, entry.name)
      expect(cached).not.toBeNull()
      expect(cached?.name).toBe(entry.name)
      expect(cached?.id).toBe(entry.id)
      expect(cached?.colo).toBe(entry.colo)
    })
  })

  describe('invalidateDORegistryCache', () => {
    it('should remove entry from cache', async () => {
      const entry = { ...sampleEntry, name: `invalidate-test-${Date.now()}` }
      await cacheEntry(defaultConfig, entry)

      // Verify it's cached
      let cached = await lookupFromCache(defaultConfig, entry.namespace, entry.name)
      expect(cached).not.toBeNull()

      // Invalidate
      await invalidateDORegistryCache(defaultConfig, entry.namespace, entry.name)

      // Verify it's removed
      cached = await lookupFromCache(defaultConfig, entry.namespace, entry.name)
      expect(cached).toBeNull()
    })
  })
})

// ============================================================================
// DORegistryDO (L2 Index) Tests - Real DO
// ============================================================================

describe('DORegistryDO (L2 Index) - Real DO', () => {
  // Get a fresh DO stub for each test
  function getRegistryDO(name: string = 'test-registry'): DurableObjectStub {
    const id = env.DO_REGISTRY.idFromName(name)
    return env.DO_REGISTRY.get(id)
  }

  describe('GET /lookup/{namespace}/{name}', () => {
    it('should return 404 if entry does not exist', async () => {
      const stub = getRegistryDO('lookup-404-test')
      const response = await stub.fetch('https://internal/lookup/MY_DO/nonexistent')

      expect(response.status).toBe(404)
      expect(await response.text()).toBe('Not Found')
    })

    it('should return entry if it exists', async () => {
      const stub = getRegistryDO('lookup-exists-test')

      // First register an entry
      const entry: DORegistryEntry = {
        namespace: 'MY_DO',
        name: 'user-123',
        id: 'abc123def456',
        colo: 'IAD',
        createdAt: 1000000,
        lastAccessedAt: 1000000,
        metadata: { tier: 'premium' },
      }

      await stub.fetch('https://internal/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      })

      // Now lookup
      const response = await stub.fetch('https://internal/lookup/MY_DO/user-123')

      expect(response.status).toBe(200)
      const result = await response.json<DORegistryEntry>()
      expect(result.name).toBe('user-123')
      expect(result.namespace).toBe('MY_DO')
      expect(result.id).toBe('abc123def456')
      expect(result.colo).toBe('IAD')
      expect(result.metadata).toEqual({ tier: 'premium' })
    })

    it('should handle URL-encoded names', async () => {
      const stub = getRegistryDO('lookup-encoded-test')

      const entry: DORegistryEntry = {
        namespace: 'MY_DO',
        name: 'user/with/slashes',
        id: 'encoded123',
        colo: 'LAX',
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      }

      await stub.fetch('https://internal/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      })

      const response = await stub.fetch(
        `https://internal/lookup/MY_DO/${encodeURIComponent('user/with/slashes')}`
      )

      expect(response.status).toBe(200)
      const result = await response.json<DORegistryEntry>()
      expect(result.name).toBe('user/with/slashes')
    })
  })

  describe('POST /register', () => {
    it('should create a new entry', async () => {
      const stub = getRegistryDO('register-create-test')

      const entry: DORegistryEntry = {
        namespace: 'MY_DO',
        name: 'new-entry',
        id: 'new123',
        colo: 'ORD',
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      }

      const response = await stub.fetch('https://internal/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      })

      expect(response.status).toBe(200)
      const result = await response.json<{ ok: boolean }>()
      expect(result.ok).toBe(true)

      // Verify the entry was created
      const lookupResponse = await stub.fetch('https://internal/lookup/MY_DO/new-entry')
      expect(lookupResponse.status).toBe(200)
    })

    it('should update existing entry (upsert) while preserving createdAt', async () => {
      const stub = getRegistryDO('register-upsert-test')

      // Create initial entry
      const originalEntry: DORegistryEntry = {
        namespace: 'MY_DO',
        name: 'upsert-entry',
        id: 'original-hex',
        colo: 'IAD',
        createdAt: 1000000,
        lastAccessedAt: 1000000,
        metadata: { version: 1 },
      }

      await stub.fetch('https://internal/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(originalEntry),
      })

      // Update the entry
      const updatedEntry: DORegistryEntry = {
        namespace: 'MY_DO',
        name: 'upsert-entry',
        id: 'updated-hex',
        colo: 'LAX',
        createdAt: 2000000, // Different createdAt
        lastAccessedAt: 3000000,
        metadata: { version: 2 },
      }

      await stub.fetch('https://internal/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedEntry),
      })

      // Verify the update
      const response = await stub.fetch('https://internal/lookup/MY_DO/upsert-entry')
      const result = await response.json<DORegistryEntry>()

      expect(result.id).toBe('updated-hex')
      expect(result.colo).toBe('LAX')
      expect(result.createdAt).toBe(1000000) // Original preserved
      expect(result.lastAccessedAt).toBe(3000000)
      expect(result.metadata).toEqual({ version: 2 })
    })
  })

  describe('POST /access', () => {
    it('should update lastAccessedAt', async () => {
      const stub = getRegistryDO('access-update-test')

      // Create entry
      const entry: DORegistryEntry = {
        namespace: 'MY_DO',
        name: 'access-entry',
        id: 'access123',
        colo: 'IAD',
        createdAt: 1000000,
        lastAccessedAt: 1000000,
      }

      await stub.fetch('https://internal/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      })

      // Update access time
      await stub.fetch('https://internal/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          namespace: 'MY_DO',
          name: 'access-entry',
          accessedAt: 5000000,
        }),
      })

      // Verify update
      const response = await stub.fetch('https://internal/lookup/MY_DO/access-entry')
      const result = await response.json<DORegistryEntry>()

      expect(result.lastAccessedAt).toBe(5000000)
      expect(result.createdAt).toBe(1000000) // Unchanged
    })

    it('should succeed even if entry does not exist (no-op)', async () => {
      const stub = getRegistryDO('access-noop-test')

      const response = await stub.fetch('https://internal/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          namespace: 'MY_DO',
          name: 'nonexistent',
          accessedAt: Date.now(),
        }),
      })

      expect(response.status).toBe(200)
    })
  })

  describe('GET /stats', () => {
    it('should return correct counts', async () => {
      const stub = getRegistryDO('stats-test')

      // Add multiple entries
      const entries: DORegistryEntry[] = [
        { namespace: 'NS1', name: 'entry1', id: 'hex1', colo: 'IAD', createdAt: Date.now(), lastAccessedAt: Date.now() },
        { namespace: 'NS1', name: 'entry2', id: 'hex2', colo: 'LAX', createdAt: Date.now(), lastAccessedAt: Date.now() },
        { namespace: 'NS2', name: 'entry3', id: 'hex3', colo: 'ORD', createdAt: Date.now(), lastAccessedAt: Date.now() },
      ]

      for (const entry of entries) {
        await stub.fetch('https://internal/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry),
        })
      }

      const response = await stub.fetch('https://internal/stats')
      const stats = await response.json<{ totalEntries: number; byNamespace: Record<string, number> }>()

      expect(stats.totalEntries).toBe(3)
      expect(stats.byNamespace['NS1']).toBe(2)
      expect(stats.byNamespace['NS2']).toBe(1)
    })

    it('should return empty stats when no entries', async () => {
      const stub = getRegistryDO('stats-empty-test')

      const response = await stub.fetch('https://internal/stats')
      const stats = await response.json<{ totalEntries: number; byNamespace: Record<string, number> }>()

      expect(stats.totalEntries).toBe(0)
      expect(Object.keys(stats.byNamespace)).toHaveLength(0)
    })
  })

  describe('Error handling', () => {
    it('should return 404 for unknown routes', async () => {
      const stub = getRegistryDO('error-test')

      const response = await stub.fetch('https://internal/unknown-route')
      expect(response.status).toBe(404)
    })

    it('should return 400 for malformed lookup path', async () => {
      const stub = getRegistryDO('error-test-2')

      const response = await stub.fetch('https://internal/lookup/only-namespace')
      expect(response.status).toBe(400)
    })
  })
})

// ============================================================================
// createDORegistry Factory Tests
// ============================================================================

describe('createDORegistry', () => {
  // Note: These tests need the actual DO namespace binding
  // They verify the factory function creates a working registry

  describe('getStats', () => {
    it('should return initial stats with zero values', () => {
      const registry = createDORegistry(env.DO_REGISTRY as unknown as DurableObjectNamespace)
      const stats = registry.getStats()

      expect(stats.l1CacheHits).toBe(0)
      expect(stats.l2IndexHits).toBe(0)
      expect(stats.l3CreationFallbacks).toBe(0)
      expect(stats.registrations).toBe(0)
      expect(stats.hitRate).toBe(0)
    })
  })
})
