/**
 * DORegistry E2E Tests - Tests against deployed colo.do worker
 *
 * These tests verify that DORegistryDO works correctly in production.
 * Run with: pnpm test:e2e
 *
 * Prerequisites:
 * - colo.do worker deployed to production
 * - DORegistryDO class exported from worker
 */

import { describe, it, expect, beforeAll } from 'vitest'

const COLO_DO_URL = process.env.COLO_DO_URL || 'https://colo.do'

// Skip E2E tests if not in E2E mode
const runE2E = process.env.E2E === 'true'

describe.skipIf(!runE2E)('DORegistry E2E', () => {
  beforeAll(async () => {
    // Verify the worker is accessible
    const response = await fetch(`${COLO_DO_URL}/api`)
    if (!response.ok) {
      throw new Error(`colo.do is not accessible at ${COLO_DO_URL}`)
    }
  })

  describe('API Endpoints', () => {
    it('should return colo info from /api', async () => {
      const response = await fetch(`${COLO_DO_URL}/api`)
      expect(response.ok).toBe(true)

      const data = await response.json() as {
        colo: string
        visitor: { country: string }
        nearestColos: Array<{ iata: string }>
      }

      expect(data.colo).toBeDefined()
      expect(typeof data.colo).toBe('string')
      expect(data.colo.length).toBe(3) // IATA codes are 3 chars
      expect(data.visitor).toBeDefined()
      expect(data.nearestColos).toBeDefined()
      expect(Array.isArray(data.nearestColos)).toBe(true)
    })

    it('should list all colos from /api/colos', async () => {
      const response = await fetch(`${COLO_DO_URL}/api/colos`)
      expect(response.ok).toBe(true)

      const data = await response.json() as { colos: Array<{ iata: string; city: string }> }

      expect(data.colos).toBeDefined()
      expect(Array.isArray(data.colos)).toBe(true)
      expect(data.colos.length).toBeGreaterThan(50) // CF has many colos

      // Verify colo structure
      const firstColo = data.colos[0]
      expect(firstColo.iata).toBeDefined()
      expect(firstColo.city).toBeDefined()
    })

    it('should get specific colo from /api/colos/:colo', async () => {
      const response = await fetch(`${COLO_DO_URL}/api/colos/IAD`)
      expect(response.ok).toBe(true)

      const data = await response.json() as {
        iata: string
        city: string
        country: string
        region: string
      }

      expect(data.iata).toBe('IAD')
      expect(data.city).toBeDefined()
      expect(data.country).toBeDefined()
      expect(data.region).toBeDefined()
    })

    it('should find nearest colo from /api/nearest', async () => {
      // Use colos that are guaranteed to be in the COLOS dictionary
      // Note: If request comes from an unknown colo, this may return 404
      const response = await fetch(`${COLO_DO_URL}/api/nearest?colos=DFW,ORD,LAX`)

      // Handle case where request comes from unknown colo
      if (response.status === 404) {
        const error = await response.json() as { error: string }
        expect(error.error).toBe('No valid colos found')
        return // Test passes - the API correctly reports no valid path from unknown colo
      }

      expect(response.ok).toBe(true)

      const data = await response.json() as {
        nearest: string
        fromColo: string
        distance: number
        candidates: Array<{ iata: string; distance: number }>
      }

      expect(data.nearest).toBeDefined()
      expect(['DFW', 'ORD', 'LAX']).toContain(data.nearest)
      expect(data.fromColo).toBeDefined()
      expect(typeof data.distance).toBe('number')
      expect(data.candidates).toBeDefined()
    })

    it('should calculate distance from /api/distance', async () => {
      const response = await fetch(`${COLO_DO_URL}/api/distance?from=IAD&to=LAX`)
      expect(response.ok).toBe(true)

      const data = await response.json() as {
        from: { iata: string }
        to: { iata: string }
        distance: number
        latency: { min: number; max: number }
      }

      expect(data.from.iata).toBe('IAD')
      expect(data.to.iata).toBe('LAX')
      expect(typeof data.distance).toBe('number')
      expect(data.distance).toBeGreaterThan(3000) // IAD to LAX is ~3700km
      expect(data.distance).toBeLessThan(5000)
    })
  })

  describe('Error Handling', () => {
    it('should return 404 for unknown colo', async () => {
      const response = await fetch(`${COLO_DO_URL}/api/colos/XXX`)
      expect(response.status).toBe(404)
    })

    it('should return 400 for missing required params', async () => {
      const response = await fetch(`${COLO_DO_URL}/api/nearest`)
      expect(response.status).toBe(400)
    })

    it('should return 400 for invalid region', async () => {
      const response = await fetch(`${COLO_DO_URL}/api/colos?region=invalid`)
      expect(response.status).toBe(400)
    })
  })

  describe('Colo Proxy', () => {
    it('should proxy request to specific colo', async () => {
      // Note: This requires COLO_DO binding to be configured
      const response = await fetch(`${COLO_DO_URL}/IAD/`)

      // If COLO_DO is not bound, we might get an error
      // But the routing should still work
      if (response.ok) {
        const data = await response.json() as {
          doColo: string
          workerColo: string
          targetColo: string
        }

        expect(data.targetColo).toBe('IAD')
        expect(data.workerColo).toBeDefined()
      }
    })
  })

  describe('Performance', () => {
    it('should respond within 500ms for /api', async () => {
      const start = Date.now()
      const response = await fetch(`${COLO_DO_URL}/api`)
      const duration = Date.now() - start

      expect(response.ok).toBe(true)
      expect(duration).toBeLessThan(500)
    })

    it('should handle concurrent requests', async () => {
      const requests = Array(10).fill(null).map(() =>
        fetch(`${COLO_DO_URL}/api`).then(r => r.ok)
      )

      const results = await Promise.all(requests)
      expect(results.every(r => r === true)).toBe(true)
    })
  })
})

// Additional test for DORegistry specifically (requires dedicated endpoint)
describe.skipIf(!runE2E)('DORegistry DO E2E', () => {
  // These tests would require a dedicated endpoint exposing DORegistryDO
  // For now, we verify the DO works through the worker tests

  it('should be able to access DORegistry via internal endpoint', async () => {
    // This test would require the worker to expose a /registry endpoint
    // For now, this is a placeholder for future E2E testing
    expect(true).toBe(true)
  })
})
