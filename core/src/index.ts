/**
 * colo.do - Location-aware Durable Objects
 *
 * Create, target, and manage Durable Objects in specific Cloudflare colocations.
 *
 * @example
 * ```typescript
 * import { createBufferedEnv } from 'colo.do'
 * import { env } from 'cloudflare:workers'
 *
 * // Recommended: Buffered environment wrapper (handles traffic spikes)
 * const $ = createBufferedEnv(env, {
 *   registry: env.REGISTRY_DO,
 *   bucket: env.REGISTRY_BUCKET,
 * })
 *
 * // Create a PostgresDO in LAX (instant, registration is async)
 * const { stub, name } = $.create.POSTGRES({ in: 'LAX' })
 *
 * // Get existing DO by name (uses R2 cache)
 * const result = await $.get.POSTGRES('my-database')
 *
 * // Don't forget to flush in waitUntil
 * ctx.waitUntil($.flush())
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

// DO targeting (simple, no registry)
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

// Colo-aware DO base class
export {
  ColoAwareDO,
  withColoAwareness,
  addWorkerColoHeader,
  type ColoContext,
} from './do.js'

// Registry (name→ID mapping with colo tracking)
export {
  RegistryDO,
  RegistryClient,
  type RegistryEntry,
  type RegistrySnapshot,
  type CreateOptions,
  type GetOptions,
  type LookupResult,
  type RegistryEnv,
} from './registry.js'

// Environment wrapper (simple API)
export {
  wrapEnv,
  invalidateCache,
  clearCache,
  type WrapEnvOptions,
  type WrappedEnv,
  type CreateResult,
  type GetResult,
} from './env.js'

// Buffered registry (handles traffic spikes)
export {
  createBufferedEnv,
  generateLocalId,
  parseLocalId,
  RegistrationBuffer,
  ShardedRegistry,
  type BufferConfig,
  type BufferedEnvOptions,
} from './buffered-registry.js'

// Self-registering DO pattern
export {
  SelfRegisteringDO,
  withSelfRegistration,
  type RegistrationConfig,
} from './self-registering.js'

// Cache API registry (FREE reads with SWR)
export {
  createCachedEnv,
  CachedRegistryClient,
  type CacheConfig,
  type CachedEnvOptions,
} from './cached-registry.js'

// DORegistry - 31x faster DO ID resolution
export {
  // Factory function
  createDORegistry,
  // L2 Index DO
  DORegistryDO,
  // L1 Cache helpers
  getCache,
  buildCacheKey,
  isCacheStale,
  cacheEntry,
  lookupFromCache,
  invalidateDORegistryCache,
  DEFAULT_FAST_REGISTRY_CONFIG,
  // Types
  type DORegistry,
  type DORegistryEntry,
  type DORegistryConfig,
  type DORegistryStats,
  type DORegistryEnv,
  type DORegistryGetOptions,
} from './do-registry.js'

// Colo Cluster - Simple DO creation API + mesh across all 278 DO-capable colos
export {
  // Simple API (recommended)
  createDO,
  getDO,
  // Cluster factory
  createColoCluster,
  // Data
  DO_CAPABLE_COLOS,
  isDOCapable,
  fetchWDOLData,
  parseWDOLData,
  seedCluster,
  // Types
  type CreateDOOptions,
  type CreateDOResult,
  type DOColo,
  type DOCapableColo,
  type ColoCluster,
  type ClusterStatus,
} from './colo-cluster.js'

// Colo Service - RPC/service binding for programmatic DO management
export {
  // Service DO
  ColoServiceDO,
  // Client for service binding
  createColoClient,
  // Migration helper
  migrateDO,
  // Types
  type ColoClient,
  type CreateInColoOptions,
  type CreateInColoResult,
  type MoveDOOptions,
  type MoveDOResult,
  type DOLocationResult,
  type MigrateOptions,
  type MigrateResult,
} from './colo-service.js'
