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
  SAN: { iata: 'SAN', city: 'San Diego', country: 'US', region: 'wnam', lat: 32.7336, lon: -117.1897, hasDO: true },
  SMF: { iata: 'SMF', city: 'Sacramento', country: 'US', region: 'wnam', lat: 38.6954, lon: -121.5908, hasDO: true },
  ABQ: { iata: 'ABQ', city: 'Albuquerque', country: 'US', region: 'wnam', lat: 35.0402, lon: -106.6094, hasDO: true },
  HNL: { iata: 'HNL', city: 'Honolulu', country: 'US', region: 'wnam', lat: 21.3245, lon: -157.9251, hasDO: true },
  ANC: { iata: 'ANC', city: 'Anchorage', country: 'US', region: 'wnam', lat: 61.1743, lon: -149.9962, hasDO: true },
  YVR: { iata: 'YVR', city: 'Vancouver', country: 'CA', region: 'wnam', lat: 49.1947, lon: -123.1792, hasDO: true },
  YYC: { iata: 'YYC', city: 'Calgary', country: 'CA', region: 'wnam', lat: 51.1215, lon: -114.0076, hasDO: true },
  YEG: { iata: 'YEG', city: 'Edmonton', country: 'CA', region: 'wnam', lat: 53.3097, lon: -113.5809, hasDO: true },

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
  MSP: { iata: 'MSP', city: 'Minneapolis', country: 'US', region: 'enam', lat: 44.8848, lon: -93.2223, hasDO: true },
  DTW: { iata: 'DTW', city: 'Detroit', country: 'US', region: 'enam', lat: 42.2162, lon: -83.3554, hasDO: true },
  CLT: { iata: 'CLT', city: 'Charlotte', country: 'US', region: 'enam', lat: 35.2140, lon: -80.9431, hasDO: true },
  RDU: { iata: 'RDU', city: 'Raleigh', country: 'US', region: 'enam', lat: 35.8776, lon: -78.7875, hasDO: true },
  PHL: { iata: 'PHL', city: 'Philadelphia', country: 'US', region: 'enam', lat: 39.8729, lon: -75.2437, hasDO: true },
  IAH: { iata: 'IAH', city: 'Houston', country: 'US', region: 'enam', lat: 29.9902, lon: -95.3368, hasDO: true },
  AUS: { iata: 'AUS', city: 'Austin', country: 'US', region: 'enam', lat: 30.1975, lon: -97.6664, hasDO: true },
  SAT: { iata: 'SAT', city: 'San Antonio', country: 'US', region: 'enam', lat: 29.5337, lon: -98.4698, hasDO: true },
  TPA: { iata: 'TPA', city: 'Tampa', country: 'US', region: 'enam', lat: 27.9755, lon: -82.5332, hasDO: true },
  MCO: { iata: 'MCO', city: 'Orlando', country: 'US', region: 'enam', lat: 28.4312, lon: -81.3081, hasDO: true },
  BNA: { iata: 'BNA', city: 'Nashville', country: 'US', region: 'enam', lat: 36.1263, lon: -86.6774, hasDO: true },
  MCI: { iata: 'MCI', city: 'Kansas City', country: 'US', region: 'enam', lat: 39.2976, lon: -94.7139, hasDO: true },
  STL: { iata: 'STL', city: 'St. Louis', country: 'US', region: 'enam', lat: 38.7487, lon: -90.3700, hasDO: true },
  IND: { iata: 'IND', city: 'Indianapolis', country: 'US', region: 'enam', lat: 39.7173, lon: -86.2944, hasDO: true },
  CMH: { iata: 'CMH', city: 'Columbus', country: 'US', region: 'enam', lat: 39.9980, lon: -82.8919, hasDO: true },
  CLE: { iata: 'CLE', city: 'Cleveland', country: 'US', region: 'enam', lat: 41.4117, lon: -81.8498, hasDO: true },
  PIT: { iata: 'PIT', city: 'Pittsburgh', country: 'US', region: 'enam', lat: 40.4915, lon: -80.2329, hasDO: true },
  BUF: { iata: 'BUF', city: 'Buffalo', country: 'US', region: 'enam', lat: 42.9405, lon: -78.7322, hasDO: true },
  RIC: { iata: 'RIC', city: 'Richmond', country: 'US', region: 'enam', lat: 37.5052, lon: -77.3197, hasDO: true },
  JAX: { iata: 'JAX', city: 'Jacksonville', country: 'US', region: 'enam', lat: 30.4941, lon: -81.6879, hasDO: true },
  MEM: { iata: 'MEM', city: 'Memphis', country: 'US', region: 'enam', lat: 35.0424, lon: -89.9767, hasDO: true },
  OMA: { iata: 'OMA', city: 'Omaha', country: 'US', region: 'enam', lat: 41.3032, lon: -95.8941, hasDO: true },
  OKC: { iata: 'OKC', city: 'Oklahoma City', country: 'US', region: 'enam', lat: 35.3931, lon: -97.6007, hasDO: true },
  YOW: { iata: 'YOW', city: 'Ottawa', country: 'CA', region: 'enam', lat: 45.3192, lon: -75.6692, hasDO: true },
  YWG: { iata: 'YWG', city: 'Winnipeg', country: 'CA', region: 'enam', lat: 49.9100, lon: -97.2399, hasDO: true },
  YHZ: { iata: 'YHZ', city: 'Halifax', country: 'CA', region: 'enam', lat: 44.8808, lon: -63.5085, hasDO: true },
  MEX: { iata: 'MEX', city: 'Mexico City', country: 'MX', region: 'enam', lat: 19.4361, lon: -99.0719, hasDO: true },
  GDL: { iata: 'GDL', city: 'Guadalajara', country: 'MX', region: 'enam', lat: 20.5218, lon: -103.3110, hasDO: true },
  QRO: { iata: 'QRO', city: 'Queretaro', country: 'MX', region: 'enam', lat: 20.6173, lon: -100.1859, hasDO: true },

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
  MAN: { iata: 'MAN', city: 'Manchester', country: 'GB', region: 'weur', lat: 53.3537, lon: -2.2750, hasDO: true },
  FCO: { iata: 'FCO', city: 'Rome', country: 'IT', region: 'weur', lat: 41.8003, lon: 12.2389, hasDO: true },
  BCN: { iata: 'BCN', city: 'Barcelona', country: 'ES', region: 'weur', lat: 41.2974, lon: 2.0833, hasDO: true },
  LIS: { iata: 'LIS', city: 'Lisbon', country: 'PT', region: 'weur', lat: 38.7756, lon: -9.1354, hasDO: true },
  MUC: { iata: 'MUC', city: 'Munich', country: 'DE', region: 'weur', lat: 48.3537, lon: 11.7750, hasDO: true },
  DUS: { iata: 'DUS', city: 'Dusseldorf', country: 'DE', region: 'weur', lat: 51.2895, lon: 6.7668, hasDO: true },
  HAM: { iata: 'HAM', city: 'Hamburg', country: 'DE', region: 'weur', lat: 53.6304, lon: 9.9882, hasDO: true },
  TXL: { iata: 'TXL', city: 'Berlin', country: 'DE', region: 'weur', lat: 52.5597, lon: 13.2877, hasDO: true },
  VNO: { iata: 'VNO', city: 'Vilnius', country: 'LT', region: 'weur', lat: 54.6341, lon: 25.2858, hasDO: true },
  RIX: { iata: 'RIX', city: 'Riga', country: 'LV', region: 'weur', lat: 56.9236, lon: 23.9711, hasDO: true },
  TLL: { iata: 'TLL', city: 'Tallinn', country: 'EE', region: 'weur', lat: 59.4133, lon: 24.8328, hasDO: true },
  GOT: { iata: 'GOT', city: 'Gothenburg', country: 'SE', region: 'weur', lat: 57.6686, lon: 12.2928, hasDO: true },
  LUX: { iata: 'LUX', city: 'Luxembourg', country: 'LU', region: 'weur', lat: 49.6233, lon: 6.2044, hasDO: true },
  GVA: { iata: 'GVA', city: 'Geneva', country: 'CH', region: 'weur', lat: 46.2370, lon: 6.1092, hasDO: true },
  ATH: { iata: 'ATH', city: 'Athens', country: 'GR', region: 'weur', lat: 37.9364, lon: 23.9445, hasDO: true },
  KEF: { iata: 'KEF', city: 'Reykjavik', country: 'IS', region: 'weur', lat: 63.9850, lon: -22.6056, hasDO: true },

  // Eastern Europe
  WAW: { iata: 'WAW', city: 'Warsaw', country: 'PL', region: 'eeur', lat: 52.1657, lon: 20.9671, hasDO: true },
  PRG: { iata: 'PRG', city: 'Prague', country: 'CZ', region: 'eeur', lat: 50.1008, lon: 14.2600, hasDO: true },
  VIE: { iata: 'VIE', city: 'Vienna', country: 'AT', region: 'eeur', lat: 48.1103, lon: 16.5697, hasDO: true },
  BUD: { iata: 'BUD', city: 'Budapest', country: 'HU', region: 'eeur', lat: 47.4369, lon: 19.2556, hasDO: true },
  SOF: { iata: 'SOF', city: 'Sofia', country: 'BG', region: 'eeur', lat: 42.6952, lon: 23.4063, hasDO: true },
  OTP: { iata: 'OTP', city: 'Bucharest', country: 'RO', region: 'eeur', lat: 44.5711, lon: 26.0858, hasDO: true },
  BEG: { iata: 'BEG', city: 'Belgrade', country: 'RS', region: 'eeur', lat: 44.8184, lon: 20.3091, hasDO: true },
  ZAG: { iata: 'ZAG', city: 'Zagreb', country: 'HR', region: 'eeur', lat: 45.7429, lon: 16.0688, hasDO: true },
  KBP: { iata: 'KBP', city: 'Kyiv', country: 'UA', region: 'eeur', lat: 50.3450, lon: 30.8947, hasDO: true },
  MSQ: { iata: 'MSQ', city: 'Minsk', country: 'BY', region: 'eeur', lat: 53.8825, lon: 28.0308, hasDO: true },
  LED: { iata: 'LED', city: 'St Petersburg', country: 'RU', region: 'eeur', lat: 59.8003, lon: 30.2625, hasDO: true },
  DME: { iata: 'DME', city: 'Moscow', country: 'RU', region: 'eeur', lat: 55.4088, lon: 37.9063, hasDO: true },
  IST: { iata: 'IST', city: 'Istanbul', country: 'TR', region: 'eeur', lat: 41.2753, lon: 28.7519, hasDO: true },
  TBS: { iata: 'TBS', city: 'Tbilisi', country: 'GE', region: 'eeur', lat: 41.6692, lon: 44.9547, hasDO: true },
  EVN: { iata: 'EVN', city: 'Yerevan', country: 'AM', region: 'eeur', lat: 40.1473, lon: 44.3959, hasDO: true },
  GYD: { iata: 'GYD', city: 'Baku', country: 'AZ', region: 'eeur', lat: 40.4675, lon: 50.0467, hasDO: true },

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
  MNL: { iata: 'MNL', city: 'Manila', country: 'PH', region: 'apac', lat: 14.5086, lon: 121.0194, hasDO: true },
  CGK: { iata: 'CGK', city: 'Jakarta', country: 'ID', region: 'apac', lat: -6.1256, lon: 106.6559, hasDO: true },
  HAN: { iata: 'HAN', city: 'Hanoi', country: 'VN', region: 'apac', lat: 21.2187, lon: 105.8050, hasDO: true },
  SGN: { iata: 'SGN', city: 'Ho Chi Minh City', country: 'VN', region: 'apac', lat: 10.8188, lon: 106.6519, hasDO: true },
  PNH: { iata: 'PNH', city: 'Phnom Penh', country: 'KH', region: 'apac', lat: 11.5465, lon: 104.8441, hasDO: true },
  KIX: { iata: 'KIX', city: 'Osaka', country: 'JP', region: 'apac', lat: 34.4320, lon: 135.2304, hasDO: true },
  FUK: { iata: 'FUK', city: 'Fukuoka', country: 'JP', region: 'apac', lat: 33.5859, lon: 130.4514, hasDO: true },
  OKA: { iata: 'OKA', city: 'Okinawa', country: 'JP', region: 'apac', lat: 26.1958, lon: 127.6459, hasDO: true },
  PEK: { iata: 'PEK', city: 'Beijing', country: 'CN', region: 'apac', lat: 40.0799, lon: 116.6031, hasDO: true },
  PVG: { iata: 'PVG', city: 'Shanghai', country: 'CN', region: 'apac', lat: 31.1434, lon: 121.8052, hasDO: true },
  CAN: { iata: 'CAN', city: 'Guangzhou', country: 'CN', region: 'apac', lat: 23.3924, lon: 113.2988, hasDO: true },
  SZX: { iata: 'SZX', city: 'Shenzhen', country: 'CN', region: 'apac', lat: 22.6393, lon: 113.8107, hasDO: true },
  BLR: { iata: 'BLR', city: 'Bangalore', country: 'IN', region: 'apac', lat: 13.1986, lon: 77.7066, hasDO: true },
  MAA: { iata: 'MAA', city: 'Chennai', country: 'IN', region: 'apac', lat: 12.9941, lon: 80.1709, hasDO: true },
  HYD: { iata: 'HYD', city: 'Hyderabad', country: 'IN', region: 'apac', lat: 17.2403, lon: 78.4294, hasDO: true },
  CCU: { iata: 'CCU', city: 'Kolkata', country: 'IN', region: 'apac', lat: 22.6547, lon: 88.4467, hasDO: true },
  CMB: { iata: 'CMB', city: 'Colombo', country: 'LK', region: 'apac', lat: 7.1807, lon: 79.8841, hasDO: true },
  DAC: { iata: 'DAC', city: 'Dhaka', country: 'BD', region: 'apac', lat: 23.8433, lon: 90.3978, hasDO: true },
  KTM: { iata: 'KTM', city: 'Kathmandu', country: 'NP', region: 'apac', lat: 27.6966, lon: 85.3591, hasDO: true },
  ISB: { iata: 'ISB', city: 'Islamabad', country: 'PK', region: 'apac', lat: 33.5490, lon: 72.8286, hasDO: true },
  KHI: { iata: 'KHI', city: 'Karachi', country: 'PK', region: 'apac', lat: 24.9008, lon: 67.1681, hasDO: true },
  LHE: { iata: 'LHE', city: 'Lahore', country: 'PK', region: 'apac', lat: 31.5216, lon: 74.4036, hasDO: true },
  ALA: { iata: 'ALA', city: 'Almaty', country: 'KZ', region: 'apac', lat: 43.3521, lon: 77.0405, hasDO: true },
  TAS: { iata: 'TAS', city: 'Tashkent', country: 'UZ', region: 'apac', lat: 41.2575, lon: 69.2817, hasDO: true },
  ULN: { iata: 'ULN', city: 'Ulaanbaatar', country: 'MN', region: 'apac', lat: 47.8431, lon: 106.7666, hasDO: true },

  // Oceania
  SYD: { iata: 'SYD', city: 'Sydney', country: 'AU', region: 'oc', lat: -33.9399, lon: 151.1753, hasDO: true },
  MEL: { iata: 'MEL', city: 'Melbourne', country: 'AU', region: 'oc', lat: -37.6690, lon: 144.8410, hasDO: true },
  AKL: { iata: 'AKL', city: 'Auckland', country: 'NZ', region: 'oc', lat: -37.0082, lon: 174.7850, hasDO: true },
  BNE: { iata: 'BNE', city: 'Brisbane', country: 'AU', region: 'oc', lat: -27.3842, lon: 153.1175, hasDO: true },
  PER: { iata: 'PER', city: 'Perth', country: 'AU', region: 'oc', lat: -31.9403, lon: 115.9672, hasDO: true },
  ADL: { iata: 'ADL', city: 'Adelaide', country: 'AU', region: 'oc', lat: -34.9461, lon: 138.5305, hasDO: true },
  CHC: { iata: 'CHC', city: 'Christchurch', country: 'NZ', region: 'oc', lat: -43.4894, lon: 172.5320, hasDO: true },
  WLG: { iata: 'WLG', city: 'Wellington', country: 'NZ', region: 'oc', lat: -41.3272, lon: 174.8050, hasDO: true },
  NOU: { iata: 'NOU', city: 'Noumea', country: 'NC', region: 'oc', lat: -22.0146, lon: 166.2130, hasDO: true },
  PPT: { iata: 'PPT', city: 'Papeete', country: 'PF', region: 'oc', lat: -17.5537, lon: -149.6111, hasDO: true },
  SUV: { iata: 'SUV', city: 'Suva', country: 'FJ', region: 'oc', lat: -18.0433, lon: 178.5592, hasDO: true },
  GUM: { iata: 'GUM', city: 'Guam', country: 'GU', region: 'oc', lat: 13.4838, lon: 144.7959, hasDO: true },

  // South America
  GRU: { iata: 'GRU', city: 'São Paulo', country: 'BR', region: 'sam', lat: -23.4356, lon: -46.4731, hasDO: true },
  GIG: { iata: 'GIG', city: 'Rio de Janeiro', country: 'BR', region: 'sam', lat: -22.8099, lon: -43.2506, hasDO: true },
  EZE: { iata: 'EZE', city: 'Buenos Aires', country: 'AR', region: 'sam', lat: -34.8222, lon: -58.5358, hasDO: true },
  SCL: { iata: 'SCL', city: 'Santiago', country: 'CL', region: 'sam', lat: -33.3930, lon: -70.7858, hasDO: true },
  BOG: { iata: 'BOG', city: 'Bogota', country: 'CO', region: 'sam', lat: 4.7016, lon: -74.1469, hasDO: true },
  LIM: { iata: 'LIM', city: 'Lima', country: 'PE', region: 'sam', lat: -12.0219, lon: -77.1143, hasDO: true },
  CCS: { iata: 'CCS', city: 'Caracas', country: 'VE', region: 'sam', lat: 10.6010, lon: -66.9913, hasDO: true },
  UIO: { iata: 'UIO', city: 'Quito', country: 'EC', region: 'sam', lat: -0.1292, lon: -78.3575, hasDO: true },
  ASU: { iata: 'ASU', city: 'Asuncion', country: 'PY', region: 'sam', lat: -25.2400, lon: -57.5190, hasDO: true },
  MVD: { iata: 'MVD', city: 'Montevideo', country: 'UY', region: 'sam', lat: -34.8384, lon: -56.0308, hasDO: true },
  PTY: { iata: 'PTY', city: 'Panama City', country: 'PA', region: 'sam', lat: 9.0714, lon: -79.3835, hasDO: true },
  SJO: { iata: 'SJO', city: 'San Jose', country: 'CR', region: 'sam', lat: 9.9939, lon: -84.2088, hasDO: true },
  GUA: { iata: 'GUA', city: 'Guatemala City', country: 'GT', region: 'sam', lat: 14.5833, lon: -90.5275, hasDO: true },
  SJU: { iata: 'SJU', city: 'San Juan', country: 'PR', region: 'sam', lat: 18.4394, lon: -66.0018, hasDO: true },
  CUR: { iata: 'CUR', city: 'Curacao', country: 'CW', region: 'sam', lat: 12.1889, lon: -68.9598, hasDO: true },
  FOR: { iata: 'FOR', city: 'Fortaleza', country: 'BR', region: 'sam', lat: -3.7763, lon: -38.5324, hasDO: true },
  REC: { iata: 'REC', city: 'Recife', country: 'BR', region: 'sam', lat: -8.1264, lon: -34.9232, hasDO: true },
  BSB: { iata: 'BSB', city: 'Brasilia', country: 'BR', region: 'sam', lat: -15.8697, lon: -47.9172, hasDO: true },
  CWB: { iata: 'CWB', city: 'Curitiba', country: 'BR', region: 'sam', lat: -25.5285, lon: -49.1758, hasDO: true },
  POA: { iata: 'POA', city: 'Porto Alegre', country: 'BR', region: 'sam', lat: -29.9944, lon: -51.1714, hasDO: true },

  // Africa
  JNB: { iata: 'JNB', city: 'Johannesburg', country: 'ZA', region: 'afr', lat: -26.1367, lon: 28.2411, hasDO: true },
  CPT: { iata: 'CPT', city: 'Cape Town', country: 'ZA', region: 'afr', lat: -33.9715, lon: 18.6021, hasDO: true },
  CAI: { iata: 'CAI', city: 'Cairo', country: 'EG', region: 'afr', lat: 30.1219, lon: 31.4056, hasDO: true },
  LOS: { iata: 'LOS', city: 'Lagos', country: 'NG', region: 'afr', lat: 6.5774, lon: 3.3212, hasDO: true },
  NBO: { iata: 'NBO', city: 'Nairobi', country: 'KE', region: 'afr', lat: -1.3192, lon: 36.9278, hasDO: true },
  ADD: { iata: 'ADD', city: 'Addis Ababa', country: 'ET', region: 'afr', lat: 8.9778, lon: 38.7989, hasDO: true },
  DUR: { iata: 'DUR', city: 'Durban', country: 'ZA', region: 'afr', lat: -29.6144, lon: 31.1197, hasDO: true },
  ALG: { iata: 'ALG', city: 'Algiers', country: 'DZ', region: 'afr', lat: 36.6910, lon: 3.2154, hasDO: true },
  CMN: { iata: 'CMN', city: 'Casablanca', country: 'MA', region: 'afr', lat: 33.3675, lon: -7.5898, hasDO: true },
  TUN: { iata: 'TUN', city: 'Tunis', country: 'TN', region: 'afr', lat: 36.8510, lon: 10.2272, hasDO: true },
  ACC: { iata: 'ACC', city: 'Accra', country: 'GH', region: 'afr', lat: 5.6052, lon: -0.1668, hasDO: true },
  DKR: { iata: 'DKR', city: 'Dakar', country: 'SN', region: 'afr', lat: 14.7397, lon: -17.4902, hasDO: true },
  MRU: { iata: 'MRU', city: 'Mauritius', country: 'MU', region: 'afr', lat: -20.4302, lon: 57.6836, hasDO: true },

  // Middle East
  DXB: { iata: 'DXB', city: 'Dubai', country: 'AE', region: 'me', lat: 25.2528, lon: 55.3644, hasDO: true },
  TLV: { iata: 'TLV', city: 'Tel Aviv', country: 'IL', region: 'me', lat: 32.0055, lon: 34.8854, hasDO: true },
  DOH: { iata: 'DOH', city: 'Doha', country: 'QA', region: 'me', lat: 25.2610, lon: 51.5653, hasDO: true },
  AUH: { iata: 'AUH', city: 'Abu Dhabi', country: 'AE', region: 'me', lat: 24.4330, lon: 54.6511, hasDO: true },
  BAH: { iata: 'BAH', city: 'Bahrain', country: 'BH', region: 'me', lat: 26.2708, lon: 50.6336, hasDO: true },
  KWI: { iata: 'KWI', city: 'Kuwait', country: 'KW', region: 'me', lat: 29.2266, lon: 47.9689, hasDO: true },
  MCT: { iata: 'MCT', city: 'Muscat', country: 'OM', region: 'me', lat: 23.5933, lon: 58.2844, hasDO: true },
  RUH: { iata: 'RUH', city: 'Riyadh', country: 'SA', region: 'me', lat: 24.9576, lon: 46.6988, hasDO: true },
  JED: { iata: 'JED', city: 'Jeddah', country: 'SA', region: 'me', lat: 21.6796, lon: 39.1565, hasDO: true },
  AMM: { iata: 'AMM', city: 'Amman', country: 'JO', region: 'me', lat: 31.7226, lon: 35.9932, hasDO: true },
  BEY: { iata: 'BEY', city: 'Beirut', country: 'LB', region: 'me', lat: 33.8209, lon: 35.4884, hasDO: true },
  BGW: { iata: 'BGW', city: 'Baghdad', country: 'IQ', region: 'me', lat: 33.2625, lon: 44.2346, hasDO: true },
  THR: { iata: 'THR', city: 'Tehran', country: 'IR', region: 'me', lat: 35.6892, lon: 51.3114, hasDO: true },
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
