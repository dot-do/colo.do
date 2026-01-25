/**
 * colo.do - Location-aware Durable Objects
 *
 * Create, target, and manage Durable Objects in specific Cloudflare colocations.
 *
 * @example
 * ```typescript
 * import { createInColo, findNearestColo, createReplicas } from 'colo.do'
 *
 * // Create a DO in a specific colo
 * const stub = createInColo(env.MY_DO, { colo: 'LAX', id: 'my-instance' })
 *
 * // Create replicas across multiple colos
 * const replicas = createReplicas(env.MY_DO, {
 *   id: 'shared-data',
 *   colos: ['IAD', 'ORD', 'SFO', 'LHR']
 * })
 *
 * // Route to the nearest replica
 * const nearest = findNearestColo(request, ['IAD', 'ORD', 'SFO', 'LHR'])
 * const result = await replicas[nearest].getData()
 * ```
 *
 * @packageDocumentation
 */

// Colo data and utilities
export {
  COLOS,
  getColo,
  getColosByRegion,
  getDOColos,
  getAllColos,
  type ColoInfo,
  type ColoRegion,
} from './colos.js'

// Location detection and distance calculation
export {
  getLocation,
  getCurrentColo,
  calculateDistance,
  coloDistance,
  estimateLatency,
  nearestColo,
  sortByDistance,
  type LocationInfo,
} from './location.js'

// DO targeting and management
export {
  targetColo,
  createInColo,
  createReplicas,
  findNearestColo,
  getShard,
  moveDO,
  type TargetOptions,
  type TargetResult,
  type ShardOptions,
  type MoveOptions,
} from './targeting.js'

// Re-export for convenience
export { ColoAwareDO, type ColoContext } from './do.js'
