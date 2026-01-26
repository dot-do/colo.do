/**
 * Cloudflare Colocation Data
 *
 * Contains information about Cloudflare's global network of data centers.
 * IATA codes, coordinates, region info, and DO capability status.
 *
 * Types are aligned with @dotdo/types/workers/colo for ecosystem compatibility.
 * When @dotdo/types is published, this module will re-export from there.
 */

/**
 * Geographic regions for colos
 *
 * Compatible with @dotdo/types ColoRegion.
 */
export type ColoRegion =
  | 'wnam'  // Western North America
  | 'enam'  // Eastern North America
  | 'weur'  // Western Europe
  | 'eeur'  // Eastern Europe
  | 'apac'  // Asia Pacific
  | 'oc'    // Oceania
  | 'sam'   // South America
  | 'afr'   // Africa
  | 'me'    // Middle East

/**
 * Colo information including coordinates and capabilities
 *
 * Compatible with @dotdo/types ColoData interface.
 */
export interface ColoInfo {
  /** IATA airport code (e.g., 'IAD', 'ORD', 'LAX') */
  iata: string
  /** Human-readable city name */
  city: string
  /** Country code */
  country: string
  /** Region identifier */
  region: ColoRegion
  /** Latitude coordinate */
  lat: number
  /** Longitude coordinate */
  lon: number
  /** Whether this colo supports Durable Objects */
  hasDO: boolean
}

/**
 * Core Cloudflare colocations with DO support
 * These are the primary data centers where DOs can be created
 *
 * Note: This is not exhaustive - Cloudflare has 300+ colos globally,
 * but only a subset support Durable Objects.
 */
export const COLOS: Record<string, ColoInfo> = {
  // Western North America
  SJC: { iata: 'SJC', city: 'San Jose', country: 'US', region: 'wnam', lat: 37.3626, lon: -121.929, hasDO: true },
  LAX: { iata: 'LAX', city: 'Los Angeles', country: 'US', region: 'wnam', lat: 33.9416, lon: -118.4085, hasDO: true },
  SEA: { iata: 'SEA', city: 'Seattle', country: 'US', region: 'wnam', lat: 47.4502, lon: -122.3088, hasDO: true },
  SFO: { iata: 'SFO', city: 'San Francisco', country: 'US', region: 'wnam', lat: 37.6213, lon: -122.379, hasDO: true },
  PDX: { iata: 'PDX', city: 'Portland', country: 'US', region: 'wnam', lat: 45.5898, lon: -122.5951, hasDO: true },
  PHX: { iata: 'PHX', city: 'Phoenix', country: 'US', region: 'wnam', lat: 33.4373, lon: -112.0078, hasDO: true },
  DEN: { iata: 'DEN', city: 'Denver', country: 'US', region: 'wnam', lat: 39.8561, lon: -104.6737, hasDO: true },
  SLC: { iata: 'SLC', city: 'Salt Lake City', country: 'US', region: 'wnam', lat: 40.7899, lon: -111.9791, hasDO: true },
  LAS: { iata: 'LAS', city: 'Las Vegas', country: 'US', region: 'wnam', lat: 36.086, lon: -115.1537, hasDO: true },

  // Eastern North America
  IAD: { iata: 'IAD', city: 'Ashburn', country: 'US', region: 'enam', lat: 38.9531, lon: -77.4565, hasDO: true },
  EWR: { iata: 'EWR', city: 'Newark', country: 'US', region: 'enam', lat: 40.6895, lon: -74.1745, hasDO: true },
  ORD: { iata: 'ORD', city: 'Chicago', country: 'US', region: 'enam', lat: 41.9742, lon: -87.9073, hasDO: true },
  ATL: { iata: 'ATL', city: 'Atlanta', country: 'US', region: 'enam', lat: 33.6407, lon: -84.4277, hasDO: true },
  DFW: { iata: 'DFW', city: 'Dallas', country: 'US', region: 'enam', lat: 32.8998, lon: -97.0403, hasDO: true },
  MIA: { iata: 'MIA', city: 'Miami', country: 'US', region: 'enam', lat: 25.7959, lon: -80.2870, hasDO: true },
  BOS: { iata: 'BOS', city: 'Boston', country: 'US', region: 'enam', lat: 42.3656, lon: -71.0096, hasDO: true },
  YYZ: { iata: 'YYZ', city: 'Toronto', country: 'CA', region: 'enam', lat: 43.6777, lon: -79.6248, hasDO: true },
  YUL: { iata: 'YUL', city: 'Montreal', country: 'CA', region: 'enam', lat: 45.4657, lon: -73.7455, hasDO: true },

  // Western Europe
  LHR: { iata: 'LHR', city: 'London', country: 'GB', region: 'weur', lat: 51.4700, lon: -0.4543, hasDO: true },
  AMS: { iata: 'AMS', city: 'Amsterdam', country: 'NL', region: 'weur', lat: 52.3105, lon: 4.7683, hasDO: true },
  FRA: { iata: 'FRA', city: 'Frankfurt', country: 'DE', region: 'weur', lat: 50.0379, lon: 8.5622, hasDO: true },
  CDG: { iata: 'CDG', city: 'Paris', country: 'FR', region: 'weur', lat: 49.0097, lon: 2.5479, hasDO: true },
  MAD: { iata: 'MAD', city: 'Madrid', country: 'ES', region: 'weur', lat: 40.4983, lon: -3.5676, hasDO: true },
  MXP: { iata: 'MXP', city: 'Milan', country: 'IT', region: 'weur', lat: 45.6289, lon: 8.7231, hasDO: true },
  DUB: { iata: 'DUB', city: 'Dublin', country: 'IE', region: 'weur', lat: 53.4264, lon: -6.2499, hasDO: true },
  ZRH: { iata: 'ZRH', city: 'Zurich', country: 'CH', region: 'weur', lat: 47.4582, lon: 8.5555, hasDO: true },
  BRU: { iata: 'BRU', city: 'Brussels', country: 'BE', region: 'weur', lat: 50.9010, lon: 4.4856, hasDO: true },
  CPH: { iata: 'CPH', city: 'Copenhagen', country: 'DK', region: 'weur', lat: 55.6180, lon: 12.6508, hasDO: true },
  ARN: { iata: 'ARN', city: 'Stockholm', country: 'SE', region: 'weur', lat: 59.6498, lon: 17.9238, hasDO: true },
  OSL: { iata: 'OSL', city: 'Oslo', country: 'NO', region: 'weur', lat: 60.1976, lon: 11.0004, hasDO: true },
  HEL: { iata: 'HEL', city: 'Helsinki', country: 'FI', region: 'weur', lat: 60.3172, lon: 24.9633, hasDO: true },

  // Eastern Europe
  WAW: { iata: 'WAW', city: 'Warsaw', country: 'PL', region: 'eeur', lat: 52.1657, lon: 20.9671, hasDO: true },
  PRG: { iata: 'PRG', city: 'Prague', country: 'CZ', region: 'eeur', lat: 50.1008, lon: 14.2600, hasDO: true },
  VIE: { iata: 'VIE', city: 'Vienna', country: 'AT', region: 'eeur', lat: 48.1103, lon: 16.5697, hasDO: true },
  BUD: { iata: 'BUD', city: 'Budapest', country: 'HU', region: 'eeur', lat: 47.4369, lon: 19.2556, hasDO: true },

  // Asia Pacific
  NRT: { iata: 'NRT', city: 'Tokyo', country: 'JP', region: 'apac', lat: 35.7720, lon: 140.3929, hasDO: true },
  HKG: { iata: 'HKG', city: 'Hong Kong', country: 'HK', region: 'apac', lat: 22.3080, lon: 113.9185, hasDO: true },
  SIN: { iata: 'SIN', city: 'Singapore', country: 'SG', region: 'apac', lat: 1.3644, lon: 103.9915, hasDO: true },
  ICN: { iata: 'ICN', city: 'Seoul', country: 'KR', region: 'apac', lat: 37.4602, lon: 126.4407, hasDO: true },
  BOM: { iata: 'BOM', city: 'Mumbai', country: 'IN', region: 'apac', lat: 19.0896, lon: 72.8656, hasDO: true },
  DEL: { iata: 'DEL', city: 'Delhi', country: 'IN', region: 'apac', lat: 28.5562, lon: 77.1000, hasDO: true },
  BKK: { iata: 'BKK', city: 'Bangkok', country: 'TH', region: 'apac', lat: 13.6900, lon: 100.7501, hasDO: true },
  TPE: { iata: 'TPE', city: 'Taipei', country: 'TW', region: 'apac', lat: 25.0797, lon: 121.2342, hasDO: true },
  KUL: { iata: 'KUL', city: 'Kuala Lumpur', country: 'MY', region: 'apac', lat: 2.7456, lon: 101.7099, hasDO: true },

  // Oceania
  SYD: { iata: 'SYD', city: 'Sydney', country: 'AU', region: 'oc', lat: -33.9399, lon: 151.1753, hasDO: true },
  MEL: { iata: 'MEL', city: 'Melbourne', country: 'AU', region: 'oc', lat: -37.6690, lon: 144.8410, hasDO: true },
  AKL: { iata: 'AKL', city: 'Auckland', country: 'NZ', region: 'oc', lat: -37.0082, lon: 174.7850, hasDO: true },

  // South America
  GRU: { iata: 'GRU', city: 'São Paulo', country: 'BR', region: 'sam', lat: -23.4356, lon: -46.4731, hasDO: true },
  GIG: { iata: 'GIG', city: 'Rio de Janeiro', country: 'BR', region: 'sam', lat: -22.8099, lon: -43.2506, hasDO: true },
  EZE: { iata: 'EZE', city: 'Buenos Aires', country: 'AR', region: 'sam', lat: -34.8222, lon: -58.5358, hasDO: true },
  SCL: { iata: 'SCL', city: 'Santiago', country: 'CL', region: 'sam', lat: -33.3930, lon: -70.7858, hasDO: true },

  // Africa
  JNB: { iata: 'JNB', city: 'Johannesburg', country: 'ZA', region: 'afr', lat: -26.1367, lon: 28.2411, hasDO: true },
  CPT: { iata: 'CPT', city: 'Cape Town', country: 'ZA', region: 'afr', lat: -33.9715, lon: 18.6021, hasDO: true },

  // Middle East
  DXB: { iata: 'DXB', city: 'Dubai', country: 'AE', region: 'me', lat: 25.2528, lon: 55.3644, hasDO: true },
  TLV: { iata: 'TLV', city: 'Tel Aviv', country: 'IL', region: 'me', lat: 32.0055, lon: 34.8854, hasDO: true },
}

/**
 * Get colo info by IATA code
 */
export function getColo(iata: string): ColoInfo | undefined {
  return COLOS[iata.toUpperCase()]
}

/**
 * Get all colos in a region
 */
export function getColosByRegion(region: ColoRegion): ColoInfo[] {
  return Object.values(COLOS).filter(c => c.region === region)
}

/**
 * Get all colos that support Durable Objects
 */
export function getDOColos(): ColoInfo[] {
  return Object.values(COLOS).filter(c => c.hasDO)
}

/**
 * Get all IATA codes
 */
export function getAllColos(): string[] {
  return Object.keys(COLOS)
}
