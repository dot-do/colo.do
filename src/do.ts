/**
 * Colo-Aware Durable Object Base Class
 *
 * Provides location awareness to Durable Objects, including:
 * - Current colo detection
 * - Worker colo tracking
 * - Latency estimation
 * - Migration support
 */

import { getColo, type ColoInfo } from './colos.js'
import { coloDistance, estimateLatency, nearestColo, sortByDistance } from './location.js'

/**
 * Context information available to colo-aware DOs
 */
export interface ColoContext {
  /** The colo where this DO instance is running */
  colo: string
  /** Full colo information */
  coloInfo?: ColoInfo
  /** The colo of the worker that made this request (if known) */
  workerColo?: string
  /** Estimated latency from worker to DO in milliseconds */
  latencyMs?: number
  /** Distance from worker to DO in kilometers */
  distanceKm?: number
}

/**
 * Headers used for colo tracking between workers and DOs
 */
const COLO_HEADER = 'X-CF-Colo'
const WORKER_COLO_HEADER = 'X-Worker-Colo'

/**
 * Base class for location-aware Durable Objects
 *
 * Extend this class to get automatic colo detection and tracking.
 *
 * @example
 * ```typescript
 * import { ColoAwareDO, type ColoContext } from 'colo.do'
 *
 * export class MyDO extends ColoAwareDO {
 *   async fetch(request: Request): Promise<Response> {
 *     const ctx = this.getColoContext(request)
 *
 *     console.log(`DO running in ${ctx.colo}`)
 *     console.log(`Worker called from ${ctx.workerColo}`)
 *     console.log(`Estimated latency: ${ctx.latencyMs}ms`)
 *
 *     return new Response(JSON.stringify(ctx))
 *   }
 * }
 * ```
 */
export abstract class ColoAwareDO implements DurableObject {
  protected state: DurableObjectState
  protected env: unknown

  /** Cached colo for this DO instance */
  private _colo: string | null = null

  constructor(state: DurableObjectState, env: unknown) {
    this.state = state
    this.env = env
  }

  /**
   * Get the colo where this DO is running
   *
   * Note: This is detected on first fetch request.
   * Before any requests, it returns undefined.
   */
  get colo(): string | undefined {
    return this._colo ?? undefined
  }

  /**
   * Get full colo information for this DO's location
   */
  get coloInfo(): ColoInfo | undefined {
    return this._colo ? getColo(this._colo) : undefined
  }

  /**
   * Get the colo context for a request
   *
   * This extracts the worker colo from headers and calculates
   * latency/distance information.
   */
  protected getColoContext(request: Request): ColoContext {
    // Try to detect our colo from the request
    if (!this._colo) {
      const cf = (request as unknown as { cf?: IncomingRequestCfProperties }).cf
      this._colo = cf?.colo ?? null
    }

    const workerColo = request.headers.get(WORKER_COLO_HEADER) ?? undefined
    const colo = this._colo ?? 'UNKNOWN'

    let latencyMs: number | undefined
    let distanceKm: number | undefined

    if (workerColo && this._colo) {
      distanceKm = coloDistance(workerColo, this._colo)
      latencyMs = estimateLatency(workerColo, this._colo)
    }

    return {
      colo,
      coloInfo: getColo(colo),
      workerColo,
      latencyMs,
      distanceKm,
    }
  }

  /**
   * Override this in your DO to handle requests
   */
  abstract fetch(request: Request): Promise<Response>

  /**
   * Get sorted list of colos by distance from this DO
   */
  protected getColosByDistance(colos?: string[]): Array<{ colo: string; distance: number; latency: number }> {
    if (!this._colo) return []
    return sortByDistance(this._colo, colos)
  }

  /**
   * Find the nearest colo from a list of candidates
   */
  protected findNearestColo(candidates: string[]): string | undefined {
    if (!this._colo) return candidates[0]
    return nearestColo(this._colo, candidates)
  }

  /**
   * Check if another colo would be better for this DO
   * based on where most requests are coming from
   *
   * Override trackRequestSource() to enable this feature.
   */
  protected shouldMigrate(requestSources: Map<string, number>): string | undefined {
    if (!this._colo || requestSources.size === 0) return undefined

    // Find the most common request source
    let maxCount = 0
    let maxColo: string | undefined

    for (const [colo, count] of requestSources) {
      if (count > maxCount) {
        maxCount = count
        maxColo = colo
      }
    }

    // If most requests come from a different colo, suggest migration
    if (maxColo && maxColo !== this._colo) {
      const currentLatency = estimateLatency(maxColo, this._colo) ?? 0
      // Only suggest migration if it would save significant latency (>20ms)
      if (currentLatency > 20) {
        return maxColo
      }
    }

    return undefined
  }

  /**
   * Create a request with colo headers for calling other DOs
   *
   * Use this when one DO needs to call another to pass colo info.
   */
  protected createRequest(url: string, init?: RequestInit): Request {
    const headers = new Headers(init?.headers)
    if (this._colo) {
      headers.set(WORKER_COLO_HEADER, this._colo)
    }
    return new Request(url, { ...init, headers })
  }
}

/**
 * Mixin to add colo awareness to any DO class
 *
 * Use this if you can't extend ColoAwareDO directly.
 *
 * @example
 * ```typescript
 * import { withColoAwareness } from 'colo.do'
 *
 * class MyDO implements DurableObject {
 *   state: DurableObjectState
 *   env: Env
 *
 *   constructor(state: DurableObjectState, env: Env) {
 *     this.state = state
 *     this.env = env
 *   }
 *
 *   async fetch(request: Request) {
 *     return new Response('Hello')
 *   }
 * }
 *
 * // Add colo awareness
 * export default withColoAwareness(MyDO)
 * ```
 */
export function withColoAwareness<T extends new (...args: any[]) => DurableObject>(
  BaseClass: T
) {
  return class ColoAware extends BaseClass {
    /** @internal */
    _coloCached: string | null = null

    get coloCached(): string | undefined {
      return this._coloCached ?? undefined
    }

    getColoContext(request: Request): ColoContext {
      if (!this._coloCached) {
        const cf = (request as unknown as { cf?: IncomingRequestCfProperties }).cf
        this._coloCached = cf?.colo ?? null
      }

      const workerColo = request.headers.get(WORKER_COLO_HEADER) ?? undefined
      const colo = this._coloCached ?? 'UNKNOWN'

      return {
        colo,
        coloInfo: getColo(colo),
        workerColo,
        latencyMs: workerColo && this._coloCached
          ? estimateLatency(workerColo, this._coloCached)
          : undefined,
        distanceKm: workerColo && this._coloCached
          ? coloDistance(workerColo, this._coloCached)
          : undefined,
      }
    }
  }
}

/**
 * Helper to add worker colo header to requests made to DOs
 *
 * Use this in your worker when calling DOs to pass location info.
 *
 * @example
 * ```typescript
 * export default {
 *   async fetch(request: Request, env: Env) {
 *     const stub = env.MY_DO.get(id)
 *
 *     // Add colo header to the request
 *     const doRequest = addWorkerColoHeader(request)
 *     return stub.fetch(doRequest)
 *   }
 * }
 * ```
 */
export function addWorkerColoHeader(request: Request): Request {
  const cf = (request as unknown as { cf?: IncomingRequestCfProperties }).cf
  const workerColo = cf?.colo

  if (!workerColo) return request

  const headers = new Headers(request.headers)
  headers.set(WORKER_COLO_HEADER, workerColo)

  return new Request(request.url, {
    method: request.method,
    headers,
    body: request.body,
  })
}
