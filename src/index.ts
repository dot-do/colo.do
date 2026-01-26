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

// PostgreSQL Index for postgres.do tenant routing
export {
  createPostgresIndex,
  getRegionForColo,
  PostgresIndexDO,
  type PostgresTenantEntry,
  type PostgresIndexConfig,
  type PostgresIndexStats,
  type PostgresIndexEnv,
  type RegisterTenantInput,
} from './postgres-index.js'

// FastRegistry - 31x faster DO ID resolution
export {
  // Factory function
  createFastRegistry,
  // L2 Index DO
  FastRegistryDO,
  // L1 Cache helpers
  getCache,
  buildCacheKey,
  isCacheStale,
  cacheEntry,
  lookupFromCache,
  invalidateFastRegistryCache,
  DEFAULT_FAST_REGISTRY_CONFIG,
  // Types
  type FastRegistry,
  type FastRegistryEntry,
  type FastRegistryConfig,
  type FastRegistryStats,
  type FastRegistryEnv,
} from './fast-registry.js'
