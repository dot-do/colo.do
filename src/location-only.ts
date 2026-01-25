/**
 * colo.do/location - Location utilities only (no registry, no capnweb)
 *
 * Minimal entry point for apps that just need colo data and distance calculations.
 * Use this for smallest bundle size when you don't need DO registry features.
 */

// Colo data
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

// DO targeting (simple, no registry - just ID manipulation)
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
