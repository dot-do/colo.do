/**
 * Location Detection and Distance Calculation
 *
 * Utilities for determining current location and calculating
 * distances between colocations.
 *
 * Types are aligned with @dotdo/types/workers/colo for ecosystem compatibility.
 */

import { COLOS, getColo, type ColoInfo } from './colos.js'

/**
 * Location information extracted from request context
 *
 * Compatible with @dotdo/types LocationInfo interface.
 */
export interface LocationInfo {
  /** Current colo IATA code (from cf.colo) */
  colo: string
  /** Full colo information if available */
  coloInfo?: ColoInfo
  /** Visitor's latitude (from cf.latitude) */
  latitude?: number
  /** Visitor's longitude (from cf.longitude) */
  longitude?: number
  /** Visitor's country (from cf.country) */
  country?: string
  /** Visitor's city (from cf.city) */
  city?: string
  /** Visitor's region (from cf.region) */
  region?: string
  /** Visitor's timezone (from cf.timezone) */
  timezone?: string
}

/**
 * Extract location information from a Cloudflare request
 *
 * @example
 * ```typescript
 * export default {
 *   fetch(request, env) {
 *     const location = getLocation(request)
 *     console.log(`Request handled by ${location.colo}`)
 *   }
 * }
 * ```
 */
export function getLocation(request: Request): LocationInfo {
  // Access cf object (available in Cloudflare Workers)
  const cf = (request as unknown as { cf?: IncomingRequestCfProperties }).cf

  const colo = cf?.colo ?? 'UNKNOWN'
  const coloInfo = getColo(colo)

  return {
    colo,
    coloInfo,
    latitude: cf?.latitude ? parseFloat(cf.latitude) : undefined,
    longitude: cf?.longitude ? parseFloat(cf.longitude) : undefined,
    country: cf?.country,
    city: cf?.city,
    region: cf?.region,
    timezone: cf?.timezone,
  }
}

/**
 * Get the current colo from a request
 * Shorthand for getLocation(request).colo
 */
export function getCurrentColo(request: Request): string {
  return getLocation(request).colo
}

/**
 * Calculate the great-circle distance between two points using Haversine formula
 *
 * @param lat1 - Latitude of point 1
 * @param lon1 - Longitude of point 1
 * @param lat2 - Latitude of point 2
 * @param lon2 - Longitude of point 2
 * @returns Distance in kilometers
 */
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371 // Earth's radius in kilometers

  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180)
}

/**
 * Calculate distance between two colos by IATA code
 *
 * @param from - Source colo IATA code
 * @param to - Destination colo IATA code
 * @returns Distance in kilometers, or undefined if either colo is unknown
 */
export function coloDistance(from: string, to: string): number | undefined {
  const fromColo = getColo(from)
  const toColo = getColo(to)

  if (!fromColo || !toColo) return undefined

  return calculateDistance(fromColo.lat, fromColo.lon, toColo.lat, toColo.lon)
}

/**
 * Estimate latency between two colos based on distance
 *
 * Uses a simplified model: ~0.05ms per km (speed of light in fiber + overhead)
 *
 * @param from - Source colo IATA code
 * @param to - Destination colo IATA code
 * @returns Estimated round-trip latency in milliseconds
 */
export function estimateLatency(from: string, to: string): number | undefined {
  const distance = coloDistance(from, to)
  if (distance === undefined) return undefined

  // Speed of light in fiber is ~200,000 km/s
  // RTT = 2 * distance / speed * 1000 (ms)
  // Plus ~5ms overhead for routing/processing
  const propagationDelay = (2 * distance / 200000) * 1000
  const overhead = 5

  return Math.round(propagationDelay + overhead)
}

/**
 * Find the nearest colo from a list of candidates
 *
 * @param from - Source colo IATA code or coordinates
 * @param candidates - List of candidate colo IATA codes
 * @returns Nearest colo IATA code, or undefined if no valid candidates
 */
export function nearestColo(
  from: string | { lat: number; lon: number },
  candidates: string[]
): string | undefined {
  let fromLat: number
  let fromLon: number

  if (typeof from === 'string') {
    const fromColo = getColo(from)
    if (!fromColo) return undefined
    fromLat = fromColo.lat
    fromLon = fromColo.lon
  } else {
    fromLat = from.lat
    fromLon = from.lon
  }

  let nearest: string | undefined
  let minDistance = Infinity

  for (const candidate of candidates) {
    const colo = getColo(candidate)
    if (!colo) continue

    const distance = calculateDistance(fromLat, fromLon, colo.lat, colo.lon)
    if (distance < minDistance) {
      minDistance = distance
      nearest = candidate
    }
  }

  return nearest
}

/**
 * Sort colos by distance from a reference point
 *
 * @param from - Source colo IATA code or coordinates
 * @param colos - List of colo IATA codes to sort (defaults to all DO-capable colos)
 * @returns Sorted array of { colo, distance, latency } objects
 */
export function sortByDistance(
  from: string | { lat: number; lon: number },
  colos?: string[]
): Array<{ colo: string; distance: number; latency: number }> {
  let fromLat: number
  let fromLon: number

  if (typeof from === 'string') {
    const fromColo = getColo(from)
    if (!fromColo) return []
    fromLat = fromColo.lat
    fromLon = fromColo.lon
  } else {
    fromLat = from.lat
    fromLon = from.lon
  }

  const candidates = colos ?? Object.keys(COLOS)

  return candidates
    .map(candidate => {
      const colo = getColo(candidate)
      if (!colo) return null

      const distance = calculateDistance(fromLat, fromLon, colo.lat, colo.lon)
      const latency = Math.round((2 * distance / 200000) * 1000 + 5)

      return { colo: candidate, distance, latency }
    })
    .filter((x): x is { colo: string; distance: number; latency: number } => x !== null)
    .sort((a, b) => a.distance - b.distance)
}
