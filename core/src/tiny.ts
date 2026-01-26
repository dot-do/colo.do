/**
 * colo.do/tiny - Absolute minimum: just colo data + distance
 *
 * ~2KB gzipped. Use when you only need:
 * - Look up colo info by IATA code
 * - Calculate distances between colos
 * - Estimate latency
 */

export {
  COLOS,
  getColo,
  getAllColos,
  type ColoInfo,
  type ColoRegion,
} from './colos.js'

export {
  coloDistance,
  estimateLatency,
  nearestColo,
  sortByDistance,
} from './location.js'
