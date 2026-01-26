/**
 * Colo Targeting E2E Tests
 *
 * Tests the simple createDO/getDO API against deployed worker.
 *
 * IMPORTANT: Cloudflare's locationHint is a HINT, not a guarantee.
 * Actual DO placement depends on:
 * 1. The request's origin colo
 * 2. Which "host" colos can run DOs (see where.durableobjects.live)
 * 3. Cloudflare's load balancing and availability
 *
 * To test from different locations, use:
 * - bunny.net HTTP test: https://tools.bunny.net/http-test?query=https://colo.do/api
 * - Or deploy test workers in different regions
 *
 * Run with: E2E=true pnpm test src/__tests__/colo-targeting.e2e.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'

const COLO_DO_URL = process.env.COLO_DO_URL || 'https://colo-do.dotdo.workers.dev'
const runE2E = process.env.E2E === 'true'

interface ColoDOResponse {
  doId: string
  doName: string | null
  initTime: number
  requestColo: string
  workerColo: string
  targetColo: string
  targetColoInfo?: {
    iata: string
    city: string
    region: string
  }
  processingMs: number
  roundTripMs: number
}

describe.skipIf(!runE2E)('Colo Targeting E2E', () => {
  let currentColo: string

  beforeAll(async () => {
    // Get our current colo
    const response = await fetch(`${COLO_DO_URL}/api`)
    const data = await response.json() as { colo: string }
    currentColo = data.colo
    console.log(`Running tests from colo: ${currentColo}`)
  })

  describe('DO Proxy Endpoint', () => {
    it('should create DO with target colo', async () => {
      const response = await fetch(`${COLO_DO_URL}/IAD/`)
      expect(response.ok).toBe(true)

      const data = await response.json() as ColoDOResponse

      expect(data.targetColo).toBe('IAD')
      expect(data.workerColo).toBe(currentColo)
      expect(data.doId).toBeDefined()
      expect(typeof data.roundTripMs).toBe('number')
    })

    it('should create unique DOs for different colos', async () => {
      const [iad, ord] = await Promise.all([
        fetch(`${COLO_DO_URL}/IAD/`).then(r => r.json() as Promise<ColoDOResponse>),
        fetch(`${COLO_DO_URL}/ORD/`).then(r => r.json() as Promise<ColoDOResponse>),
      ])

      // Each colo gets its own DO
      expect(iad.doId).not.toBe(ord.doId)
      expect(iad.targetColo).toBe('IAD')
      expect(ord.targetColo).toBe('ORD')
    })

    it('should return consistent DO for same colo', async () => {
      const response1 = await fetch(`${COLO_DO_URL}/LAX/`)
      const data1 = await response1.json() as ColoDOResponse

      const response2 = await fetch(`${COLO_DO_URL}/LAX/`)
      const data2 = await response2.json() as ColoDOResponse

      // Same colo should return same DO
      expect(data1.doId).toBe(data2.doId)
    })
  })

  describe('Latency Patterns', () => {
    it('should show cold start on first access', async () => {
      // Use a unique colo to ensure cold start
      const uniqueColo = 'GRU' // São Paulo - less commonly tested
      const response = await fetch(`${COLO_DO_URL}/${uniqueColo}/`)
      const data = await response.json() as ColoDOResponse

      // Cold starts typically take 100-300ms
      // (though may be warm if recently accessed)
      expect(data.roundTripMs).toBeGreaterThan(0)
    })

    it('should show warm performance on subsequent access', async () => {
      // First request warms the DO
      await fetch(`${COLO_DO_URL}/DFW/`)

      // Second request should be fast
      const response = await fetch(`${COLO_DO_URL}/DFW/`)
      const data = await response.json() as ColoDOResponse

      // Warm DOs should respond in <50ms processing time
      expect(data.processingMs).toBeLessThan(50)
    })

    it('should measure round-trip time', async () => {
      const response = await fetch(`${COLO_DO_URL}/SFO/`)
      const data = await response.json() as ColoDOResponse

      expect(data.roundTripMs).toBeDefined()
      expect(typeof data.roundTripMs).toBe('number')
      // Round-trip should be positive
      expect(data.roundTripMs).toBeGreaterThan(0)
    })
  })

  describe('Colo Info', () => {
    it('should include target colo info', async () => {
      const response = await fetch(`${COLO_DO_URL}/LHR/`)
      const data = await response.json() as ColoDOResponse

      expect(data.targetColoInfo).toBeDefined()
      expect(data.targetColoInfo?.iata).toBe('LHR')
      expect(data.targetColoInfo?.city).toBe('London')
      expect(data.targetColoInfo?.region).toBe('weur')
    })

    it('should return 404 for unknown colo', async () => {
      const response = await fetch(`${COLO_DO_URL}/XXX/`)
      expect(response.status).toBe(404)
    })
  })

  describe('WDOL Integration', () => {
    it('should be able to fetch WDOL data', async () => {
      const response = await fetch('https://where.durableobjects.live/api/v3/data.json')
      expect(response.ok).toBe(true)

      const data = await response.json() as { colos: Record<string, unknown> }
      expect(data.colos).toBeDefined()
      expect(Object.keys(data.colos).length).toBeGreaterThan(200)
    })

    it('should understand routing from current colo', async () => {
      const response = await fetch('https://where.durableobjects.live/api/v3/data.json')
      const data = await response.json() as {
        colos: Record<string, {
          hosts: Record<string, { likelihood: number; latency: number }>
          nearestRegion: string
        }>
      }

      const coloData = data.colos[currentColo]
      if (coloData) {
        console.log(`Colo ${currentColo} routes to:`, coloData.hosts)
        console.log(`Nearest region:`, coloData.nearestRegion)
        expect(Object.keys(coloData.hosts).length).toBeGreaterThan(0)
      } else {
        // Colo not in WDOL data - might be a new colo
        console.log(`Colo ${currentColo} not found in WDOL data`)
      }
    })
  })
})

describe.skipIf(!runE2E)('Colo Simple API Types', () => {
  // These tests verify the API is exported correctly
  // Actual usage tests are in the workers test file

  it('should export createDO function', async () => {
    const { createDO } = await import('../colo-cluster')
    expect(typeof createDO).toBe('function')
  })

  it('should export getDO function', async () => {
    const { getDO } = await import('../colo-cluster')
    expect(typeof getDO).toBe('function')
  })

  it('should export DO_CAPABLE_COLOS', async () => {
    const { DO_CAPABLE_COLOS } = await import('../colo-cluster')
    expect(Array.isArray(DO_CAPABLE_COLOS)).toBe(true)
    expect(DO_CAPABLE_COLOS.length).toBe(278)
  })

  it('should export isDOCapable', async () => {
    const { isDOCapable } = await import('../colo-cluster')
    expect(isDOCapable('LAX')).toBe(true)
    expect(isDOCapable('XXX')).toBe(false)
  })
})
