/**
 * Durable Object Targeting
 *
 * Utilities for creating and targeting DOs in specific colocations.
 * This leverages Cloudflare's deterministic DO ID generation to route
 * DOs to specific colos.
 */

import { getColo, getAllColos, type ColoInfo } from './colos.js'
import { getCurrentColo, nearestColo, sortByDistance } from './location.js'

/**
 * DO targeting options
 */
export interface TargetOptions {
  /**
   * Target colo IATA code (e.g., 'LAX', 'IAD', 'LHR')
   * If not specified, uses the current colo or nearest DO-capable colo
   */
  colo?: string

  /**
   * Fallback colos to try if the primary colo is unavailable
   */
  fallback?: string[]

  /**
   * Prefix for the DO ID (helps organize DOs)
   */
  prefix?: string

  /**
   * The unique identifier for this DO instance
   */
  id: string
}

/**
 * Result of targeting a DO
 */
export interface TargetResult {
  /** The colo where the DO will be created */
  colo: string
  /** The full DO name used for ID generation */
  name: string
  /** Information about the target colo */
  coloInfo?: ColoInfo
}

/**
 * Generate a DO name that will be placed in a specific colo
 *
 * The technique: Cloudflare uses deterministic ID generation from names.
 * By using a name that includes the colo code, we influence where the DO
 * is likely to be created (not guaranteed, but highly probable).
 *
 * @example
 * ```typescript
 * // Create a DO ID that will be in LAX
 * const { name } = targetColo({ colo: 'LAX', id: 'user-123' })
 * const doId = env.MY_DO.idFromName(name)
 * ```
 */
export function targetColo(options: TargetOptions): TargetResult {
  const { colo, fallback = [], prefix, id } = options

  // Determine target colo
  let targetColo = colo?.toUpperCase()

  // Validate colo exists
  if (targetColo && !getColo(targetColo)) {
    // Try fallbacks
    for (const fb of fallback) {
      if (getColo(fb.toUpperCase())) {
        targetColo = fb.toUpperCase()
        break
      }
    }
  }

  // If still no valid colo, throw error
  if (!targetColo || !getColo(targetColo)) {
    throw new Error(`Invalid colo: ${colo}. Valid colos: ${getAllColos().join(', ')}`)
  }

  // Build the name with colo hint
  // Format: [prefix:]colo:id
  const nameParts = [targetColo, id]
  if (prefix) {
    nameParts.unshift(prefix)
  }
  const name = nameParts.join(':')

  return {
    colo: targetColo,
    name,
    coloInfo: getColo(targetColo),
  }
}

/**
 * Create a DO stub that will be placed in a specific colo
 *
 * @example
 * ```typescript
 * // Create a PostgresDO in LAX
 * const stub = await createInColo(env.POSTGRES_DO, {
 *   colo: 'LAX',
 *   id: 'my-database'
 * })
 *
 * // Call methods on the DO
 * const result = await stub.query('SELECT * FROM users')
 * ```
 */
export function createInColo<T extends DurableObjectNamespace>(
  namespace: T,
  options: TargetOptions
): DurableObjectStub {
  const { name } = targetColo(options)
  const id = namespace.idFromName(name)
  return namespace.get(id)
}

/**
 * Create multiple DO replicas in different colos
 *
 * @example
 * ```typescript
 * // Create MongoDB replicas in multiple colos
 * const replicas = createReplicas(env.MONGO_DO, {
 *   id: 'my-collection',
 *   colos: ['IAD', 'ORD', 'SFO', 'LHR']
 * })
 *
 * // Query the nearest replica
 * const nearestColo = findNearestColo(request, ['IAD', 'ORD', 'SFO', 'LHR'])
 * const result = await replicas[nearestColo].find({ active: true })
 * ```
 */
export function createReplicas<T extends DurableObjectNamespace>(
  namespace: T,
  options: {
    id: string
    colos: string[]
    prefix?: string
  }
): Record<string, DurableObjectStub> {
  const { id, colos, prefix } = options
  const replicas: Record<string, DurableObjectStub> = {}

  for (const colo of colos) {
    replicas[colo.toUpperCase()] = createInColo(namespace, {
      colo,
      id,
      prefix,
    })
  }

  return replicas
}

/**
 * Find the nearest colo from a request and list of available colos
 *
 * @example
 * ```typescript
 * const nearestColo = findNearestColo(request, ['IAD', 'ORD', 'SFO', 'LHR'])
 * const stub = replicas[nearestColo]
 * ```
 */
export function findNearestColo(request: Request, colos: string[]): string {
  const currentColo = getCurrentColo(request)
  const nearest = nearestColo(currentColo, colos)

  if (!nearest) {
    throw new Error(`No valid colos found. Available: ${colos.join(', ')}`)
  }

  return nearest
}

/**
 * Options for sharding a DO across colos
 */
export interface ShardOptions {
  /** The shard key (e.g., user ID, tenant ID) */
  key: string
  /** Number of shards per colo */
  shardsPerColo?: number
  /** Colos to distribute shards across */
  colos?: string[]
  /** Prefix for shard names */
  prefix?: string
}

/**
 * Get the shard for a given key
 *
 * Distributes keys across colos and shards within each colo
 * using consistent hashing.
 *
 * @example
 * ```typescript
 * // Get the shard for a user
 * const { colo, shardId, name } = getShard({
 *   key: 'user-12345',
 *   colos: ['IAD', 'ORD', 'SFO', 'LHR'],
 *   shardsPerColo: 16
 * })
 *
 * const stub = env.USER_DO.get(env.USER_DO.idFromName(name))
 * ```
 */
export function getShard(options: ShardOptions): {
  colo: string
  shardId: number
  name: string
} {
  const {
    key,
    shardsPerColo = 16,
    colos = getAllColos(),
    prefix = 'shard'
  } = options

  // Simple hash function for consistent distribution
  const hash = simpleHash(key)

  // Determine colo (consistent across all keys with same hash)
  const coloIndex = hash % colos.length
  const colo = colos[coloIndex].toUpperCase()

  // Determine shard within colo
  const shardId = Math.floor(hash / colos.length) % shardsPerColo

  // Build name
  const name = `${prefix}:${colo}:${shardId}`

  return { colo, shardId, name }
}

/**
 * Simple hash function for consistent distribution
 */
function simpleHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash)
}

/**
 * DO movement options (for relocating a DO to a different colo)
 */
export interface MoveOptions {
  /** Current DO stub */
  from: DurableObjectStub
  /** Target colo */
  toColo: string
  /** Target namespace for the new DO */
  namespace: DurableObjectNamespace
  /** ID for the new DO */
  id: string
  /** Optional: migrate data using this function */
  migrate?: (from: DurableObjectStub, to: DurableObjectStub) => Promise<void>
}

/**
 * Create a new DO in a different colo (for migration)
 *
 * Note: This creates a new DO and optionally migrates data.
 * The old DO is not automatically deleted - you must handle that separately.
 *
 * @example
 * ```typescript
 * // Move a DO from current location to LAX
 * const newStub = await moveDO({
 *   from: oldStub,
 *   toColo: 'LAX',
 *   namespace: env.MY_DO,
 *   id: 'my-instance',
 *   migrate: async (from, to) => {
 *     const data = await from.export()
 *     await to.import(data)
 *   }
 * })
 * ```
 */
export async function moveDO(options: MoveOptions): Promise<DurableObjectStub> {
  const { from, toColo, namespace, id, migrate } = options

  // Create new DO in target colo
  const newStub = createInColo(namespace, {
    colo: toColo,
    id,
  })

  // Run migration if provided
  if (migrate) {
    await migrate(from, newStub)
  }

  return newStub
}
