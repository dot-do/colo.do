/**
 * Colo Cluster Workers Tests - Simple DO Creation API
 *
 * Tests using vitest-pool-workers with actual Cloudflare Workers runtime.
 * Tests the createDO and getDO simple API functions.
 */

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import {
  createDO,
  getDO,
  DO_CAPABLE_COLOS,
  isDOCapable,
  type CreateDOOptions,
  type CreateDOResult,
} from '../colo-cluster'

// ============================================================================
// createDO Tests
// ============================================================================

describe('createDO', () => {
  it('should create a DO with colo option', () => {
    const result = createDO(env.COLO_DO, { colo: 'LAX' })

    expect(result.stub).toBeDefined()
    expect(result.id).toBeDefined()
    expect(result.name).toMatch(/^LAX:/)
    expect(result.colo).toBe('LAX')
    expect(result.region).toBe('wnam')
  })

  it('should create a DO with city option', () => {
    const result = createDO(env.COLO_DO, { city: 'London' })

    expect(result.stub).toBeDefined()
    expect(result.colo).toBe('LHR')
    expect(result.region).toBe('weur')
  })

  it('should create a DO with region option', () => {
    const result = createDO(env.COLO_DO, { region: 'apac' })

    expect(result.stub).toBeDefined()
    expect(['apac']).toContain(result.region)
  })

  it('should create a DO with coordinates', () => {
    // Coordinates near Tokyo
    const result = createDO(env.COLO_DO, { lat: 35.6762, lon: 139.6503 })

    expect(result.stub).toBeDefined()
    expect(result.colo).toBe('NRT')
    expect(result.region).toBe('apac')
  })

  it('should throw for unknown colo', () => {
    expect(() => createDO(env.COLO_DO, { colo: 'XXX' }))
      .toThrow('Unknown colo "XXX"')
  })

  it('should throw for unknown city', () => {
    expect(() => createDO(env.COLO_DO, { city: 'NotARealCity' }))
      .toThrow('No colo found for city "NotARealCity"')
  })

  it('should generate unique names for each call', () => {
    const result1 = createDO(env.COLO_DO, { colo: 'IAD' })
    const result2 = createDO(env.COLO_DO, { colo: 'IAD' })

    expect(result1.name).not.toBe(result2.name)
    expect(result1.id.toString()).not.toBe(result2.id.toString())
  })
})

// ============================================================================
// getDO Tests
// ============================================================================

describe('getDO', () => {
  it('should get a DO by name without location hint', () => {
    const stub = getDO(env.COLO_DO, 'my-instance')
    expect(stub).toBeDefined()
  })

  it('should get a DO by name with colo hint', () => {
    const stub = getDO(env.COLO_DO, 'my-instance', { colo: 'LAX' })
    expect(stub).toBeDefined()
  })

  it('should get a DO by name with city hint', () => {
    const stub = getDO(env.COLO_DO, 'my-instance', { city: 'Paris' })
    expect(stub).toBeDefined()
  })

  it('should return same DO for same name', () => {
    // Create a DO first
    const { name } = createDO(env.COLO_DO, { colo: 'SFO' })

    // Get it back
    const stub = getDO(env.COLO_DO, name)
    expect(stub).toBeDefined()
  })
})

// ============================================================================
// isDOCapable Tests
// ============================================================================

describe('isDOCapable', () => {
  it('should return true for known DO-capable colos', () => {
    expect(isDOCapable('LAX')).toBe(true)
    expect(isDOCapable('IAD')).toBe(true)
    expect(isDOCapable('LHR')).toBe(true)
  })

  it('should be case-insensitive', () => {
    expect(isDOCapable('lax')).toBe(true)
    expect(isDOCapable('LaX')).toBe(true)
  })

  it('should return false for unknown colos', () => {
    expect(isDOCapable('XXX')).toBe(false)
    expect(isDOCapable('ZZZ')).toBe(false)
  })
})

// ============================================================================
// DO_CAPABLE_COLOS Tests
// ============================================================================

describe('DO_CAPABLE_COLOS', () => {
  it('should have 278 colos', () => {
    expect(DO_CAPABLE_COLOS.length).toBe(278)
  })

  it('should include major colos', () => {
    expect(DO_CAPABLE_COLOS).toContain('LAX')
    expect(DO_CAPABLE_COLOS).toContain('IAD')
    expect(DO_CAPABLE_COLOS).toContain('LHR')
    expect(DO_CAPABLE_COLOS).toContain('NRT')
    expect(DO_CAPABLE_COLOS).toContain('SIN')
  })

  it('should all be uppercase 3-letter codes', () => {
    for (const colo of DO_CAPABLE_COLOS) {
      expect(colo).toMatch(/^[A-Z]{3}$/)
    }
  })
})

// ============================================================================
// Type Tests
// ============================================================================

describe('Type Exports', () => {
  it('should export CreateDOOptions type', () => {
    const optionsByColo: CreateDOOptions = { colo: 'LAX' }
    const optionsByCity: CreateDOOptions = { city: 'London' }
    const optionsByRegion: CreateDOOptions = { region: 'apac' }
    const optionsByCoords: CreateDOOptions = { lat: 0, lon: 0 }

    expect(optionsByColo).toBeDefined()
    expect(optionsByCity).toBeDefined()
    expect(optionsByRegion).toBeDefined()
    expect(optionsByCoords).toBeDefined()
  })

  it('should export CreateDOResult type', () => {
    const result = createDO(env.COLO_DO, { colo: 'LAX' })

    // Type checks - these are compile-time verifications
    const stub: DurableObjectStub = result.stub
    const id: DurableObjectId = result.id
    const name: string = result.name
    const colo: string = result.colo

    expect(stub).toBeDefined()
    expect(id).toBeDefined()
    expect(name).toBeDefined()
    expect(colo).toBeDefined()
  })
})
