/**
 * Global type declarations for Cloudflare Workers environment
 *
 * These declarations extend the global scope with Cloudflare Workers-specific
 * globals that are not covered by the standard @cloudflare/workers-types.
 */

declare global {
  /**
   * Cloudflare Workers Cache API
   *
   * The `caches` global provides access to the Cache API in Workers.
   * Unlike the browser Cache API, Workers provides a `default` cache
   * that is globally available and FREE to use.
   *
   * @see https://developers.cloudflare.com/workers/runtime-apis/cache/
   */
  const caches: CacheStorage & {
    /**
     * The default cache instance, available in all Cloudflare Workers.
     *
     * This cache is:
     * - FREE (unlimited reads/writes)
     * - Globally distributed
     * - Automatically managed by Cloudflare
     *
     * @example
     * ```typescript
     * const cache = caches.default
     * await cache.put(request, response)
     * const cached = await cache.match(request)
     * ```
     */
    default: Cache
  }
}

export {}
