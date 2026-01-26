/**
 * Colo Cluster - Simple API for creating DOs in specific locations
 *
 * @example
 * ```typescript
 * import { createDO, getDO } from 'colo.do'
 *
 * // Create a DO in a specific colo by IATA code
 * const { stub, name } = createDO(env.MY_DO, { colo: 'IAD' })
 *
 * // Create by city name
 * const { stub } = createDO(env.MY_DO, { city: 'London' })
 *
 * // Create in nearest colo to a request
 * const { stub } = createDO(env.MY_DO, { near: request })
 *
 * // Get existing DO by name
 * const stub = getDO(env.MY_DO, 'my-instance')
 * ```
 */

import { COLOS, type ColoInfo, type ColoRegion } from './colos.js'

/**
 * DO-capable colo with routing information
 * Data from https://where.durableobjects.live
 */
export interface DOColo {
  /** IATA code */
  iata: string
  /** Region for this colo */
  nearestRegion: string
  /** Host colos where DOs actually run, with likelihood and latency */
  hosts: Record<string, { likelihood: number; latency: number }>
  /** Whether this colo can host its own DOs (self in hosts) */
  canHostOwn: boolean
}

// ============================================================================
// Simple DO Creation API
// ============================================================================

/**
 * Options for creating a DO in a specific location
 */
export type CreateDOOptions =
  | { colo: DOCapableColo | string }           // By IATA code
  | { city: string }                            // By city name
  | { region: ColoRegion }                      // By region
  | { near: Request }                           // Nearest to request
  | { lat: number; lon: number }                // Nearest to coordinates

/**
 * Result of creating a DO
 */
export interface CreateDOResult {
  /** DO stub ready to use */
  stub: DurableObjectStub
  /** DO ID */
  id: DurableObjectId
  /** Name used for named DOs */
  name: string
  /** Target colo IATA */
  colo: string
  /** Region hint used */
  region: ColoRegion
}

/**
 * Create a new DO in a specific location
 *
 * @example
 * ```typescript
 * // By IATA code
 * const { stub, name } = createDO(env.MY_DO, { colo: 'IAD' })
 *
 * // By city name
 * const { stub } = createDO(env.MY_DO, { city: 'London' })
 *
 * // Nearest to incoming request
 * const { stub } = createDO(env.MY_DO, { near: request })
 *
 * // By region
 * const { stub } = createDO(env.MY_DO, { region: 'enam' })
 *
 * // Nearest to coordinates
 * const { stub } = createDO(env.MY_DO, { lat: 51.5074, lon: -0.1278 })
 * ```
 */
export function createDO(
  namespace: DurableObjectNamespace,
  options: CreateDOOptions
): CreateDOResult {
  const { colo, region } = resolveLocation(options)

  // Generate a unique name with colo prefix for deterministic targeting
  const uniqueId = crypto.randomUUID()
  const name = `${colo}:${uniqueId}`

  // Use idFromName with colo-prefixed name for consistent targeting
  const id = namespace.idFromName(name)
  const stub = namespace.get(id, { locationHint: region })

  return { stub, id, name, colo, region }
}

/**
 * Get an existing DO by name
 *
 * @example
 * ```typescript
 * // Get by name
 * const stub = getDO(env.MY_DO, 'my-instance')
 *
 * // Get with location hint for better routing
 * const stub = getDO(env.MY_DO, 'my-instance', { colo: 'LAX' })
 * ```
 */
export function getDO(
  namespace: DurableObjectNamespace,
  name: string,
  options?: CreateDOOptions
): DurableObjectStub {
  const id = namespace.idFromName(name)
  if (options) {
    const { region } = resolveLocation(options)
    return namespace.get(id, { locationHint: region })
  }
  return namespace.get(id)
}

/**
 * Resolve location options to colo IATA and region
 */
function resolveLocation(options: CreateDOOptions): { colo: string; region: ColoRegion } {
  // By IATA code
  if ('colo' in options) {
    const colo = options.colo.toUpperCase()
    const info = COLOS[colo]
    if (!info) {
      throw new Error(`Unknown colo "${options.colo}". See: https://colo.do/api/colos`)
    }
    return { colo, region: info.region }
  }

  // By region directly
  if ('region' in options) {
    // Find first colo in that region
    const colo = Object.entries(COLOS).find(([_, info]) => info.region === options.region)?.[0]
    if (!colo) {
      throw new Error(`No colo found in region "${options.region}"`)
    }
    return { colo, region: options.region }
  }

  // By city name
  if ('city' in options) {
    const result = findColoByCity(options.city)
    if (!result) {
      throw new Error(`No colo found for city "${options.city}". Try using IATA code instead.`)
    }
    return result
  }

  // By request (nearest colo)
  if ('near' in options) {
    const cf = (options.near as unknown as { cf?: IncomingRequestCfProperties }).cf
    const colo = cf?.colo?.toUpperCase()
    if (colo && COLOS[colo]) {
      return { colo, region: COLOS[colo].region }
    }
    throw new Error('Cannot determine colo from request. Specify colo or city explicitly.')
  }

  // By coordinates (find nearest)
  if ('lat' in options && 'lon' in options) {
    const result = findNearestColoByCoords(options.lat, options.lon)
    if (!result) {
      throw new Error('No colo found near specified coordinates.')
    }
    return result
  }

  throw new Error('Invalid options: specify colo, city, region, near, or lat/lon')
}

/**
 * Find a colo by city name (case-insensitive, partial match)
 */
function findColoByCity(city: string): { colo: string; region: ColoRegion } | undefined {
  const normalizedCity = city.toLowerCase().replace(/\s+/g, '')

  // Try exact match first
  for (const [iata, info] of Object.entries(COLOS)) {
    if (info.city.toLowerCase().replace(/\s+/g, '') === normalizedCity) {
      return { colo: iata, region: info.region }
    }
  }

  // Try partial match
  for (const [iata, info] of Object.entries(COLOS)) {
    if (info.city.toLowerCase().includes(city.toLowerCase())) {
      return { colo: iata, region: info.region }
    }
  }

  return undefined
}

/**
 * Find nearest colo by coordinates using Haversine distance
 */
function findNearestColoByCoords(lat: number, lon: number): { colo: string; region: ColoRegion } | undefined {
  let nearest: { colo: string; region: ColoRegion } | undefined
  let minDistance = Infinity

  for (const [iata, info] of Object.entries(COLOS)) {
    if (!info.hasDO) continue
    const distance = haversineDistance(lat, lon, info.lat, info.lon)
    if (distance < minDistance) {
      minDistance = distance
      nearest = { colo: iata, region: info.region }
    }
  }

  return nearest
}

/**
 * Calculate Haversine distance between two points
 */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371 // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// ============================================================================
// Colo Cluster (DO mesh across all colos)
// ============================================================================

/**
 * Colo cluster interface - for managing a DO deployed to every colo
 */
export interface ColoCluster {
  /** Get a stub for the cluster DO in a specific colo */
  getColoDO(colo: string): DurableObjectStub
  /** Get all colo IATAs in the cluster */
  getAllColos(): string[]
  /** Check if a colo is DO-capable */
  isValidColo(colo: string): boolean
  /** Get the colo from a request */
  getNearestColo(request: Request): string | undefined
  /** Create a new DO in a specific colo (returns stub + id) */
  createInColo(targetColo: string, namespace: DurableObjectNamespace): CreateDOResult
}

/**
 * Create a colo cluster from a DO namespace
 */
export function createColoCluster(
  clusterNamespace: DurableObjectNamespace,
  coloData: Map<string, DOColo>
): ColoCluster {
  // Helper to get region from colo data or COLOS fallback
  const getRegion = (colo: string): ColoRegion => {
    const wdolData = coloData.get(colo)
    if (wdolData?.nearestRegion) {
      return wdolData.nearestRegion as ColoRegion
    }
    // Fallback to static COLOS data
    return COLOS[colo]?.region ?? 'wnam'
  }

  return {
    getColoDO(colo: string): DurableObjectStub {
      const normalizedColo = colo.toUpperCase()
      if (!coloData.has(normalizedColo)) {
        throw new Error(`Unknown colo: ${colo}. Not in DO-capable colo list.`)
      }
      const id = clusterNamespace.idFromName(`cluster:${normalizedColo}`)
      return clusterNamespace.get(id, { locationHint: getRegion(normalizedColo) })
    },

    getAllColos(): string[] {
      return Array.from(coloData.keys()).sort()
    },

    isValidColo(colo: string): boolean {
      return coloData.has(colo.toUpperCase())
    },

    getNearestColo(request: Request): string | undefined {
      const cf = (request as unknown as { cf?: IncomingRequestCfProperties }).cf
      const colo = cf?.colo?.toUpperCase()
      if (colo && coloData.has(colo)) {
        return colo
      }
      return undefined
    },

    createInColo(targetColo: string, namespace: DurableObjectNamespace): CreateDOResult {
      const normalizedColo = targetColo.toUpperCase()
      if (!coloData.has(normalizedColo)) {
        throw new Error(`Cannot create DO in unknown colo: ${targetColo}`)
      }
      return createDO(namespace, { colo: normalizedColo })
    },
  }
}

/**
 * Parse WDOL (Where Durable Objects Live) data into our format
 *
 * @param wdolData - Raw data from https://where.durableobjects.live/api/v3/data.json
 */
export function parseWDOLData(wdolData: {
  colos: Record<
    string,
    {
      hosts: Record<string, { likelihood: number; latency: number }>
      nearestRegion: string
    }
  >
}): Map<string, DOColo> {
  const result = new Map<string, DOColo>()

  for (const [iata, data] of Object.entries(wdolData.colos)) {
    result.set(iata, {
      iata,
      nearestRegion: data.nearestRegion,
      hosts: data.hosts,
      canHostOwn: iata in data.hosts,
    })
  }

  return result
}

/**
 * Fetch current WDOL data
 * Use this during deployment or periodically to update colo data
 */
export async function fetchWDOLData(): Promise<Map<string, DOColo>> {
  const response = await fetch(
    'https://where.durableobjects.live/api/v3/data.json'
  )
  if (!response.ok) {
    throw new Error(`Failed to fetch WDOL data: ${response.status}`)
  }
  const data = await response.json()
  return parseWDOLData(data as Parameters<typeof parseWDOLData>[0])
}

/**
 * Static list of DO-capable colos (278 as of Jan 2026)
 * Generated from https://where.durableobjects.live
 *
 * This is a fallback when live data isn't available.
 * Update periodically with: fetchWDOLData()
 */
export const DO_CAPABLE_COLOS = [
  'AAE', 'ABQ', 'ACC', 'ADB', 'ADL', 'AKL', 'AKX', 'ALA', 'ALG', 'AMD',
  'AMM', 'AMS', 'ARN', 'ASK', 'ASU', 'ATH', 'ATL', 'AUS', 'BAH', 'BAQ',
  'BCN', 'BEG', 'BEL', 'BEY', 'BGI', 'BGR', 'BGW', 'BKK', 'BLR', 'BNA',
  'BNE', 'BNU', 'BOD', 'BOG', 'BOM', 'BOS', 'BRU', 'BSB', 'BSR', 'BTS',
  'BUD', 'BUF', 'CAI', 'CBR', 'CCP', 'CCU', 'CDG', 'CEB', 'CFC', 'CGB',
  'CGK', 'CGP', 'CGY', 'CHC', 'CLE', 'CLO', 'CLT', 'CMB', 'CMH', 'CNF',
  'CNN', 'CNX', 'COR', 'CPH', 'CPT', 'CRK', 'CWB', 'CZL', 'DAC', 'DAD',
  'DAR', 'DEL', 'DEN', 'DFW', 'DKR', 'DME', 'DMM', 'DOH', 'DPS', 'DTW',
  'DUB', 'DUR', 'DUS', 'DXB', 'EBB', 'EBL', 'EVN', 'EWR', 'EZE', 'FCO',
  'FLN', 'FOR', 'FRA', 'FRU', 'FSD', 'FUK', 'GBE', 'GDL', 'GEO', 'GIG',
  'GOT', 'GRU', 'GUA', 'GUM', 'GYD', 'GYE', 'GYN', 'HAM', 'HAN', 'HEL',
  'HFA', 'HKG', 'HNL', 'HRE', 'HYD', 'IAD', 'IAH', 'ICN', 'IND', 'ISB',
  'IST', 'ISU', 'IXC', 'JDO', 'JED', 'JIB', 'JNB', 'JOG', 'JOI', 'KBP',
  'KCH', 'KEF', 'KGL', 'KHH', 'KHI', 'KIN', 'KIV', 'KIX', 'KJA', 'KNU',
  'KTM', 'KUL', 'KWI', 'LAD', 'LAS', 'LAX', 'LCA', 'LED', 'LHE', 'LHR',
  'LIM', 'LIS', 'LLK', 'LOS', 'LUN', 'LUX', 'LYS', 'MAA', 'MAD', 'MAN',
  'MAO', 'MBA', 'MCI', 'MCT', 'MDE', 'MEL', 'MEM', 'MEX', 'MFM', 'MIA',
  'MLA', 'MLE', 'MLG', 'MNL', 'MPM', 'MRS', 'MRU', 'MSP', 'MSQ', 'MUC',
  'MXP', 'NAG', 'NBO', 'NJF', 'NOU', 'NQN', 'NRT', 'NVT', 'OKA', 'OKC',
  'OMA', 'ORD', 'ORN', 'OSL', 'OTP', 'PAT', 'PBH', 'PBM', 'PDX', 'PER',
  'PHL', 'PHX', 'PIT', 'PMO', 'PMW', 'PNH', 'POA', 'POS', 'PPT', 'PRG',
  'PTY', 'QRO', 'QWJ', 'RAO', 'RDU', 'REC', 'RIC', 'RIX', 'RUH', 'RUN',
  'SAN', 'SAP', 'SAT', 'SCL', 'SDQ', 'SEA', 'SGN', 'SIN', 'SJC', 'SJK',
  'SJO', 'SJP', 'SJU', 'SKG', 'SLC', 'SMF', 'SOD', 'SOF', 'SSA', 'STI',
  'STL', 'STR', 'SUV', 'SYD', 'TBS', 'TGU', 'TIA', 'TLH', 'TLL', 'TLV',
  'TNR', 'TPA', 'TPE', 'TUN', 'TXL', 'UDI', 'UIO', 'ULN', 'URT', 'VCP',
  'VIE', 'VNO', 'VTE', 'WAW', 'WRO', 'XAP', 'XNH', 'YHZ', 'YOW', 'YUL',
  'YVR', 'YWG', 'YXE', 'YYC', 'YYZ', 'ZAG', 'ZDM', 'ZRH',
] as const

export type DOCapableColo = (typeof DO_CAPABLE_COLOS)[number]

/**
 * Quick check if a colo is DO-capable
 */
export function isDOCapable(colo: string): colo is DOCapableColo {
  return DO_CAPABLE_COLOS.includes(colo.toUpperCase() as DOCapableColo)
}

/**
 * Cluster seeding - warm up DOs across all colos
 *
 * Use with https://tools.bunny.net/http-test to trigger from global locations:
 * https://tools.bunny.net/http-test?query=https://colo.do/api/seed
 *
 * @param cluster - The colo cluster
 * @param request - Incoming request (used to detect current colo)
 */
export async function seedCluster(
  cluster: ColoCluster,
  request: Request
): Promise<{
  seededColo: string | undefined
  totalColos: number
  message: string
}> {
  const currentColo = cluster.getNearestColo(request)
  const totalColos = cluster.getAllColos().length

  if (!currentColo) {
    return {
      seededColo: undefined,
      totalColos,
      message: 'Request came from unknown colo - not seeded',
    }
  }

  // Touch the DO in this colo to ensure it's warm
  try {
    const stub = cluster.getColoDO(currentColo)
    await stub.fetch('https://internal/ping')
  } catch {
    // Ignore errors - the DO might not have a /ping endpoint yet
  }

  return {
    seededColo: currentColo,
    totalColos,
    message: `Seeded cluster DO in ${currentColo}`,
  }
}

/**
 * Get cluster status - which colos have active DOs
 */
export interface ClusterStatus {
  /** Total DO-capable colos */
  totalColos: number
  /** Colos that have been seeded (have warm DOs) */
  seededColos: string[]
  /** Coverage percentage */
  coverage: number
  /** Current request colo */
  currentColo: string | undefined
}
