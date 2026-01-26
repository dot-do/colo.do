/**
 * Colo Service - RPC-based service for creating DOs in any colo
 *
 * Other workers/DOs can bind to this service and use it to:
 * - Create DOs in specific colos
 * - Move DOs between colos
 * - Look up DO locations
 *
 * @example
 * ```typescript
 * // In wrangler.toml:
 * [[services]]
 * binding = "COLO"
 * service = "colo-do"
 *
 * // In your worker:
 * const { id, name, colo } = await env.COLO.create({
 *   namespace: 'POSTGRES_DO',
 *   colo: 'IAD',
 * })
 *
 * // Move a DO to a different colo:
 * const newId = await env.COLO.move({
 *   namespace: 'POSTGRES_DO',
 *   from: 'LAX:tenant-123',
 *   to: 'IAD',
 * })
 * ```
 */

import { COLOS, type ColoRegion } from './colos.js'
import { DO_CAPABLE_COLOS, isDOCapable } from './colo-cluster.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Options for creating a DO in a specific colo
 */
export interface CreateInColoOptions {
  /** Target colo IATA code */
  colo: string
  /** Optional: Custom name suffix (defaults to UUID) */
  name?: string
  /** Optional: Metadata to store with the registration */
  metadata?: Record<string, unknown>
}

/**
 * Result of creating a DO
 */
export interface CreateInColoResult {
  /** Full DO name (format: {colo}:{name}) */
  name: string
  /** The hex ID string for idFromString() */
  id: string
  /** Target colo IATA */
  colo: string
  /** Region hint used */
  region: ColoRegion
  /** Whether this was a new creation or existing */
  created: boolean
}

/**
 * Options for moving a DO to a different colo
 */
export interface MoveDOOptions {
  /** Current DO name (format: {colo}:{name}) */
  from: string
  /** Target colo IATA code */
  toColo: string
  /** Optional: New name suffix (defaults to keeping existing suffix) */
  newName?: string
}

/**
 * Result of moving a DO
 */
export interface MoveDOResult {
  /** Original DO name */
  oldName: string
  /** New DO name */
  newName: string
  /** New hex ID */
  newHexId: string
  /** New colo */
  newColo: string
  /** Old colo (extracted from original name) */
  oldColo: string
}

/**
 * DO location lookup result
 */
export interface DOLocationResult {
  /** DO name */
  name: string
  /** Colo extracted from name */
  colo: string
  /** Colo info */
  coloInfo?: {
    city: string
    country: string
    region: ColoRegion
  }
  /** Whether this colo is DO-capable */
  isDOCapable: boolean
}

// ============================================================================
// Colo Service DO
// ============================================================================

/**
 * Colo Service Durable Object
 *
 * Provides RPC methods for creating and managing DOs across colos.
 * Bind this as a service in other workers to use programmatically.
 */
export class ColoServiceDO implements DurableObject {
  constructor(private state: DurableObjectState) {}

  /**
   * Handle fetch requests (for HTTP API)
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    try {
      // Health check
      if (path === '/health' || path === '/') {
        return this.json({ status: 'ok', colos: DO_CAPABLE_COLOS.length })
      }

      // Create DO
      if (path === '/create' && request.method === 'POST') {
        const body = await request.json() as CreateInColoOptions
        const result = this.createInColo(body)
        return this.json(result)
      }

      // Move DO (prepare instructions)
      if (path === '/move' && request.method === 'POST') {
        const body = await request.json() as MoveDOOptions
        const result = this.prepareMoveInstructions(body)
        return this.json(result)
      }

      // Parse name
      if (path === '/parse') {
        const name = url.searchParams.get('name')
        if (!name) {
          return this.json({ error: 'name parameter required', code: 'MISSING_PARAM' }, 400)
        }
        const result = this.parseName(name)
        return this.json(result)
      }

      // Get location info
      if (path === '/location') {
        const name = url.searchParams.get('name')
        if (!name) {
          return this.json({ error: 'name parameter required', code: 'MISSING_PARAM' }, 400)
        }
        const result = this.getLocation(name)
        return this.json(result)
      }

      // List all DO-capable colos
      if (path === '/colos') {
        return this.json({ colos: this.listColos() })
      }

      // Validate a colo
      if (path === '/validate') {
        const colo = url.searchParams.get('colo')
        if (!colo) {
          return this.json({ error: 'colo parameter required', code: 'MISSING_PARAM' }, 400)
        }
        return this.json({ colo, valid: this.isValidColo(colo) })
      }

      return this.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return this.json({ error: message }, 500)
    }
  }

  // ==========================================================================
  // RPC Methods (callable via service binding)
  // ==========================================================================

  /**
   * Create a DO name for a specific colo
   *
   * This generates the name - the caller still needs to use
   * namespace.idFromName(name) and namespace.get(id, { locationHint })
   *
   * @example
   * ```typescript
   * const { name, colo, region } = coloService.createInColo({ colo: 'IAD' })
   * const id = env.MY_DO.idFromName(name)
   * const stub = env.MY_DO.get(id, { locationHint: region })
   * ```
   */
  createInColo(options: CreateInColoOptions): CreateInColoResult {
    const { colo, name: customName, metadata } = options

    // Validate colo
    const normalizedColo = colo.toUpperCase()
    const coloInfo = COLOS[normalizedColo]
    if (!coloInfo) {
      throw new Error(`Unknown colo: ${colo}. See https://colo.do/api/colos`)
    }

    // Generate name
    const suffix = customName ?? crypto.randomUUID()
    const fullName = `${normalizedColo}:${suffix}`

    // Generate a deterministic hex ID from the name
    // This allows idFromString() to work consistently
    const id = this.nameToHexId(fullName)

    return {
      name: fullName,
      id,
      colo: normalizedColo,
      region: coloInfo.region,
      created: true,
    }
  }

  /**
   * Generate move instructions for a DO to a new colo
   *
   * This returns the new name/ID - the caller must:
   * 1. Create the new DO
   * 2. Migrate data from old to new
   * 3. Update any routing/registry
   * 4. Delete the old DO
   *
   * @example
   * ```typescript
   * const { oldName, newName, newColo } = coloService.prepareMoveInstructions({
   *   from: 'LAX:tenant-123',
   *   toColo: 'IAD',
   * })
   *
   * // Create new DO
   * const newId = env.MY_DO.idFromName(newName)
   * const newStub = env.MY_DO.get(newId, { locationHint: 'enam' })
   *
   * // Migrate data
   * const oldId = env.MY_DO.idFromName(oldName)
   * const oldStub = env.MY_DO.get(oldId)
   * const data = await oldStub.export()
   * await newStub.import(data)
   *
   * // Update registry, delete old DO...
   * ```
   */
  prepareMoveInstructions(options: MoveDOOptions): MoveDOResult {
    const { from, toColo, newName: customNewName } = options

    // Parse the original name
    const parsed = this.parseName(from)
    if (!parsed.colo || !parsed.suffix) {
      throw new Error(`Invalid DO name format: ${from}. Expected {colo}:{name}`)
    }

    // Validate target colo
    const normalizedToColo = toColo.toUpperCase()
    if (!COLOS[normalizedToColo]) {
      throw new Error(`Unknown target colo: ${toColo}`)
    }

    // Generate new name
    const newSuffix = customNewName ?? parsed.suffix
    const newFullName = `${normalizedToColo}:${newSuffix}`
    const newHexId = this.nameToHexId(newFullName)

    return {
      oldName: from,
      newName: newFullName,
      newHexId,
      newColo: normalizedToColo,
      oldColo: parsed.colo,
    }
  }

  /**
   * Parse a DO name to extract colo and suffix
   */
  parseName(name: string): { colo: string | null; suffix: string | null; valid: boolean } {
    const parts = name.split(':')
    if (parts.length < 2) {
      return { colo: null, suffix: null, valid: false }
    }

    const [colo, ...rest] = parts
    const suffix = rest.join(':') // Handle names with colons

    return {
      colo: colo.toUpperCase(),
      suffix,
      valid: true,
    }
  }

  /**
   * Get location info for a DO name
   */
  getLocation(name: string): DOLocationResult {
    const parsed = this.parseName(name)
    const colo = parsed.colo ?? 'UNKNOWN'
    const coloInfo = COLOS[colo]

    return {
      name,
      colo,
      coloInfo: coloInfo ? {
        city: coloInfo.city,
        country: coloInfo.country,
        region: coloInfo.region,
      } : undefined,
      isDOCapable: isDOCapable(colo),
    }
  }

  /**
   * List all DO-capable colos
   */
  listColos(): string[] {
    return [...DO_CAPABLE_COLOS]
  }

  /**
   * Check if a colo is DO-capable
   */
  isValidColo(colo: string): boolean {
    return isDOCapable(colo)
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Convert a name to a deterministic hex ID
   * This creates a consistent 64-character hex string from the name
   */
  private nameToHexId(name: string): string {
    // Use a simple hash to create a deterministic ID
    // In production, this should match how CF generates IDs
    let hash = 0n
    for (let i = 0; i < name.length; i++) {
      hash = ((hash << 5n) - hash) + BigInt(name.charCodeAt(i))
      hash = hash & 0xFFFFFFFFFFFFFFFFn // Keep it 64-bit
    }

    // Create a 64-char hex string (256 bits)
    const hex1 = hash.toString(16).padStart(16, '0')
    const hash2 = hash ^ 0xDEADBEEFCAFEBABEn
    const hex2 = hash2.toString(16).padStart(16, '0')
    const hash3 = hash ^ 0x1234567890ABCDEFn
    const hex3 = hash3.toString(16).padStart(16, '0')
    const hash4 = hash ^ 0xFEDCBA0987654321n
    const hex4 = hash4.toString(16).padStart(16, '0')

    return (hex1 + hex2 + hex3 + hex4).slice(0, 64)
  }

  private json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data, null, 2), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

// ============================================================================
// Client for Service Binding
// ============================================================================

/**
 * Type-safe client for the Colo Service
 *
 * Use this when you have a service binding to colo.do
 *
 * @example
 * ```typescript
 * // In wrangler.toml:
 * [[services]]
 * binding = "COLO"
 * service = "colo-do"
 *
 * // In your code:
 * import { createColoClient } from 'colo.do'
 *
 * const colo = createColoClient(env.COLO)
 * const { name, colo: targetColo } = await colo.createInColo({ colo: 'IAD' })
 * ```
 */
export interface ColoClient {
  /** Create a DO name for a specific colo */
  createInColo(options: CreateInColoOptions): Promise<CreateInColoResult>
  /** Get move instructions for relocating a DO */
  prepareMoveInstructions(options: MoveDOOptions): Promise<MoveDOResult>
  /** Parse a DO name */
  parseName(name: string): Promise<{ colo: string | null; suffix: string | null; valid: boolean }>
  /** Get location info for a DO */
  getLocation(name: string): Promise<DOLocationResult>
  /** List all DO-capable colos */
  listColos(): Promise<string[]>
  /** Check if a colo is valid */
  isValidColo(colo: string): Promise<boolean>
}

/**
 * Create a client for the Colo Service from a service binding
 */
export function createColoClient(service: Fetcher): ColoClient {
  const baseUrl = 'https://colo-service.internal'

  return {
    async createInColo(options: CreateInColoOptions): Promise<CreateInColoResult> {
      const response = await service.fetch(`${baseUrl}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
      })
      if (!response.ok) {
        const error = await response.json() as { error: string }
        throw new Error(error.error)
      }
      return response.json()
    },

    async prepareMoveInstructions(options: MoveDOOptions): Promise<MoveDOResult> {
      const response = await service.fetch(`${baseUrl}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
      })
      if (!response.ok) {
        const error = await response.json() as { error: string }
        throw new Error(error.error)
      }
      return response.json() as Promise<MoveDOResult>
    },

    async parseName(name: string): Promise<{ colo: string | null; suffix: string | null; valid: boolean }> {
      const response = await service.fetch(`${baseUrl}/parse?name=${encodeURIComponent(name)}`)
      return response.json()
    },

    async getLocation(name: string): Promise<DOLocationResult> {
      const response = await service.fetch(`${baseUrl}/location?name=${encodeURIComponent(name)}`)
      return response.json()
    },

    async listColos(): Promise<string[]> {
      const response = await service.fetch(`${baseUrl}/colos`)
      const data = await response.json() as { colos: string[] }
      return data.colos
    },

    async isValidColo(colo: string): Promise<boolean> {
      const response = await service.fetch(`${baseUrl}/validate?colo=${encodeURIComponent(colo)}`)
      const data = await response.json() as { valid: boolean }
      return data.valid
    },
  }
}

// ============================================================================
// DO Migration Helper
// ============================================================================

/**
 * Options for the migrate helper
 */
export interface MigrateOptions<T> {
  /** The DO namespace */
  namespace: DurableObjectNamespace
  /** Current DO name */
  fromName: string
  /** Target colo */
  toColo: string
  /** Function to export data from the old DO */
  exportData: (stub: DurableObjectStub) => Promise<T>
  /** Function to import data to the new DO */
  importData: (stub: DurableObjectStub, data: T) => Promise<void>
  /** Optional: Custom new name (defaults to keeping suffix) */
  newName?: string
  /** Optional: Delete old DO after migration */
  deleteOld?: boolean
}

/**
 * Result of migration
 */
export interface MigrateResult {
  /** Old DO name */
  oldName: string
  /** New DO name */
  newName: string
  /** Old colo */
  oldColo: string
  /** New colo */
  newColo: string
  /** Whether old DO was deleted */
  oldDeleted: boolean
}

/**
 * Migrate a DO to a new colo
 *
 * This helper handles the full migration flow:
 * 1. Parse the old name to extract colo/suffix
 * 2. Create new DO in target colo
 * 3. Export data from old DO
 * 4. Import data to new DO
 * 5. Optionally delete old DO
 *
 * @example
 * ```typescript
 * const result = await migrateDO({
 *   namespace: env.POSTGRES_DO,
 *   fromName: 'LAX:tenant-123',
 *   toColo: 'IAD',
 *   exportData: async (stub) => stub.export(),
 *   importData: async (stub, data) => stub.import(data),
 *   deleteOld: true,
 * })
 *
 * console.log(`Migrated from ${result.oldColo} to ${result.newColo}`)
 * ```
 */
export async function migrateDO<T>(options: MigrateOptions<T>): Promise<MigrateResult> {
  const {
    namespace,
    fromName,
    toColo,
    exportData,
    importData,
    newName: customNewName,
    deleteOld = false,
  } = options

  // Parse old name
  const parts = fromName.split(':')
  if (parts.length < 2) {
    throw new Error(`Invalid DO name format: ${fromName}. Expected {colo}:{name}`)
  }

  const [oldColo, ...rest] = parts
  const suffix = rest.join(':')

  // Validate target colo
  const normalizedToColo = toColo.toUpperCase()
  const coloInfo = COLOS[normalizedToColo]
  if (!coloInfo) {
    throw new Error(`Unknown target colo: ${toColo}`)
  }

  // Create new name
  const newSuffix = customNewName ?? suffix
  const newFullName = `${normalizedToColo}:${newSuffix}`

  // Get old DO stub
  const oldId = namespace.idFromName(fromName)
  const oldStub = namespace.get(oldId)

  // Export data from old DO
  const data = await exportData(oldStub)

  // Create new DO stub with location hint
  const newId = namespace.idFromName(newFullName)
  const newStub = namespace.get(newId, { locationHint: coloInfo.region })

  // Import data to new DO
  await importData(newStub, data)

  // Optionally delete old DO
  let oldDeleted = false
  if (deleteOld) {
    try {
      // Try to delete via a delete() RPC if available
      // @ts-expect-error - delete may not exist on all DOs
      await oldStub.delete?.()
      oldDeleted = true
    } catch {
      // Deletion not supported or failed
      oldDeleted = false
    }
  }

  return {
    oldName: fromName,
    newName: newFullName,
    oldColo: oldColo.toUpperCase(),
    newColo: normalizedToColo,
    oldDeleted,
  }
}
