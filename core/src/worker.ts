/**
 * colo.do Worker - Durable Object Colos
 *
 * API-compatible with the original drivly/colo.do
 * Plus new features: registry, service API, expanded colo database
 */

import {
  COLOS,
  getColo,
  getAllColos,
  getColosByRegion,
  getDOColos,
} from './colos.js'
import { isValidRegion } from './validation.js'
import {
  getLocation,
  sortByDistance,
  nearestColo,
  coloDistance,
  estimateLatency,
  getDistance,
} from './location.js'
import { createDORegistry, type DORegistry } from './do-registry.js'

// Re-export DOs for wrangler bindings
export { DORegistryDO } from './do-registry.js'
export { ColoServiceDO } from './colo-service.js'

// Original API structure
export const api = {
  icon: '⚡️',
  name: 'colo.do',
  description: 'Durable Object Colos',
  url: 'https://colo.do/api',
  type: 'https://apis.do/proxies',
  endpoints: {
    getCurrentColo: 'https://colo.do/api',
    proxyFromColo: 'https://ord.colo.do/:url',
  },
  site: 'https://colo.do',
  login: 'https://colo.do/login',
  signup: 'https://colo.do/signup',
  repo: 'https://github.com/drivly/colo.do',
}

export interface Env {
  // Main colo DO (original)
  COLO: DurableObjectNamespace
  // Alias for backwards compat
  COLO_DO?: DurableObjectNamespace
  // CTX service for user info
  CTX?: Fetcher
  // Colo Service DO for programmatic DO management
  COLO_SERVICE?: DurableObjectNamespace
  // DO Registry for fast ID lookups
  DO_REGISTRY?: DurableObjectNamespace
}

// City name mapping for locations object - all DO-capable colos (PascalCase)
// Flat lookup for getting city name from IATA code
const colos: Record<string, string> = {
  // North America - West
  sjc: 'SanJose', lax: 'LosAngeles', sea: 'Seattle', sfo: 'SanFrancisco',
  pdx: 'Portland', phx: 'Phoenix', den: 'Denver', slc: 'SaltLakeCity',
  las: 'LasVegas', san: 'SanDiego', smf: 'Sacramento',
  // North America - Central
  ord: 'Chicago', dfw: 'Dallas', iah: 'Houston', msp: 'Minneapolis',
  mci: 'KansasCity', stl: 'StLouis', aus: 'Austin', sat: 'SanAntonio',
  oma: 'Omaha', okc: 'OklahomaCity',
  // North America - East
  iad: 'Ashburn', ewr: 'Newark', atl: 'Atlanta', mia: 'Miami', bos: 'Boston',
  clt: 'Charlotte', dtw: 'Detroit', phl: 'Philadelphia', rdu: 'Raleigh',
  tpa: 'Tampa', mco: 'Orlando', bna: 'Nashville', ind: 'Indianapolis',
  cmh: 'Columbus', cle: 'Cleveland', pit: 'Pittsburgh', buf: 'Buffalo',
  cvg: 'Cincinnati', jax: 'Jacksonville',
  // Canada
  yyz: 'Toronto', yul: 'Montreal', yvr: 'Vancouver', yyc: 'Calgary', yow: 'Ottawa',
  // Europe - West
  lhr: 'London', ams: 'Amsterdam', fra: 'Frankfurt', cdg: 'Paris', mad: 'Madrid',
  mxp: 'Milan', dub: 'Dublin', zrh: 'Zurich', bru: 'Brussels', mrs: 'Marseille',
  lis: 'Lisbon', bcn: 'Barcelona', man: 'Manchester', fco: 'Rome', muc: 'Munich',
  dus: 'Dusseldorf', ham: 'Hamburg', txl: 'Berlin', vie: 'Vienna',
  // Europe - North
  cph: 'Copenhagen', arn: 'Stockholm', osl: 'Oslo', hel: 'Helsinki',
  // Europe - East
  waw: 'Warsaw', prg: 'Prague', bud: 'Budapest',
  // Asia - East
  nrt: 'Tokyo', hkg: 'HongKong', icn: 'Seoul', tpe: 'Taipei',
  kix: 'Osaka', fuk: 'Fukuoka', oka: 'Okinawa',
  // Asia - Southeast
  sin: 'Singapore', bkk: 'Bangkok', kul: 'KualaLumpur', cgk: 'Jakarta',
  mnl: 'Manila', sgn: 'HoChiMinhCity', han: 'Hanoi',
  // Asia - South
  bom: 'Mumbai', del: 'Delhi', blr: 'Bangalore', maa: 'Chennai',
  hyd: 'Hyderabad', ccu: 'Kolkata',
  // Middle East
  dxb: 'Dubai', tlv: 'TelAviv', doh: 'Doha', auh: 'AbuDhabi',
  bah: 'Bahrain', kwi: 'Kuwait', mct: 'Muscat', ruh: 'Riyadh', jed: 'Jeddah',
  // Oceania
  syd: 'Sydney', mel: 'Melbourne', akl: 'Auckland', bne: 'Brisbane',
  per: 'Perth', adl: 'Adelaide', chc: 'Christchurch', wlg: 'Wellington',
  // South America
  gru: 'SaoPaulo', gig: 'RioDeJaneiro', eze: 'BuenosAires',
  scl: 'Santiago', bog: 'Bogota', lim: 'Lima',
  // Africa
  jnb: 'Johannesburg', cpt: 'CapeTown', cai: 'Cairo', los: 'Lagos', nbo: 'Nairobi',
}

// Organized by region for the locations response
const colosByRegion: Record<string, Record<string, Record<string, string>>> = {
  NorthAmerica: {
    West: {
      sjc: 'SanJose', lax: 'LosAngeles', sea: 'Seattle', sfo: 'SanFrancisco',
      pdx: 'Portland', phx: 'Phoenix', den: 'Denver', slc: 'SaltLakeCity',
      las: 'LasVegas', san: 'SanDiego', smf: 'Sacramento',
    },
    Central: {
      ord: 'Chicago', dfw: 'Dallas', iah: 'Houston', msp: 'Minneapolis',
      mci: 'KansasCity', stl: 'StLouis', aus: 'Austin', sat: 'SanAntonio',
      oma: 'Omaha', okc: 'OklahomaCity',
    },
    East: {
      iad: 'Ashburn', ewr: 'Newark', atl: 'Atlanta', mia: 'Miami', bos: 'Boston',
      clt: 'Charlotte', dtw: 'Detroit', phl: 'Philadelphia', rdu: 'Raleigh',
      tpa: 'Tampa', mco: 'Orlando', bna: 'Nashville', ind: 'Indianapolis',
      cmh: 'Columbus', cle: 'Cleveland', pit: 'Pittsburgh', buf: 'Buffalo',
      cvg: 'Cincinnati', jax: 'Jacksonville',
    },
  },
  Canada: {
    _: { yyz: 'Toronto', yul: 'Montreal', yvr: 'Vancouver', yyc: 'Calgary', yow: 'Ottawa' },
  },
  Europe: {
    West: {
      lhr: 'London', ams: 'Amsterdam', fra: 'Frankfurt', cdg: 'Paris', mad: 'Madrid',
      mxp: 'Milan', dub: 'Dublin', zrh: 'Zurich', bru: 'Brussels', mrs: 'Marseille',
      lis: 'Lisbon', bcn: 'Barcelona', man: 'Manchester', fco: 'Rome', muc: 'Munich',
      dus: 'Dusseldorf', ham: 'Hamburg', txl: 'Berlin', vie: 'Vienna',
    },
    North: { cph: 'Copenhagen', arn: 'Stockholm', osl: 'Oslo', hel: 'Helsinki' },
    East: { waw: 'Warsaw', prg: 'Prague', bud: 'Budapest' },
  },
  Asia: {
    East: {
      nrt: 'Tokyo', hkg: 'HongKong', icn: 'Seoul', tpe: 'Taipei',
      kix: 'Osaka', fuk: 'Fukuoka', oka: 'Okinawa',
    },
    Southeast: {
      sin: 'Singapore', bkk: 'Bangkok', kul: 'KualaLumpur', cgk: 'Jakarta',
      mnl: 'Manila', sgn: 'HoChiMinhCity', han: 'Hanoi',
    },
    South: {
      bom: 'Mumbai', del: 'Delhi', blr: 'Bangalore', maa: 'Chennai',
      hyd: 'Hyderabad', ccu: 'Kolkata',
    },
  },
  MiddleEast: {
    _: {
      dxb: 'Dubai', tlv: 'TelAviv', doh: 'Doha', auh: 'AbuDhabi',
      bah: 'Bahrain', kwi: 'Kuwait', mct: 'Muscat', ruh: 'Riyadh', jed: 'Jeddah',
    },
  },
  Oceania: {
    _: {
      syd: 'Sydney', mel: 'Melbourne', akl: 'Auckland', bne: 'Brisbane',
      per: 'Perth', adl: 'Adelaide', chc: 'Christchurch', wlg: 'Wellington',
    },
  },
  SouthAmerica: {
    _: {
      gru: 'SaoPaulo', gig: 'RioDeJaneiro', eze: 'BuenosAires',
      scl: 'Santiago', bog: 'Bogota', lim: 'Lima',
    },
  },
  Africa: {
    _: { jnb: 'Johannesburg', cpt: 'CapeTown', cai: 'Cairo', los: 'Lagos', nbo: 'Nairobi' },
  },
}

// Build nested locations URLs from the region structure
function buildLocationsByRegion(pathname: string, search: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [region, subregions] of Object.entries(colosByRegion)) {
    const regionResult: Record<string, unknown> = {}
    for (const [subregion, cities] of Object.entries(subregions)) {
      const subregionResult: Record<string, string> = {}
      for (const [code, name] of Object.entries(cities)) {
        subregionResult[name] = `https://${code}.colo.do${pathname}${search}`
      }
      if (subregion === '_') {
        // Flatten single-level regions (Canada, MiddleEast, etc.)
        Object.assign(regionResult, subregionResult)
      } else {
        regionResult[subregion] = subregionResult
      }
    }
    result[region] = regionResult
  }
  return result
}

/**
 * Main worker fetch handler
 */
export default {
  fetch: async (req: Request, env: Env): Promise<Response> => {
    const { hostname, pathname, search } = new URL(req.url)
    const cf = (req as unknown as { cf?: IncomingRequestCfProperties }).cf

    // Extract colo from hostname
    // Pattern 1: iad.colo.do → 'iad'
    // Pattern 2: iad-colo.workers.do → 'iad'
    // Pattern 3: colo.workers.do → null (use worker colo)
    let colo: string | undefined
    if (hostname.endsWith('.colo.do')) {
      // iad.colo.do → 'iad'
      colo = hostname.split('.')[0]
      if (colo === 'colo' || colo === 'www' || colo === 'api') colo = undefined
    } else if (hostname.match(/^([a-z]{3})-colo\.workers\.do$/i)) {
      // iad-colo.workers.do → 'iad'
      colo = hostname.split('-')[0]
    }

    // Use COLO binding (or fall back to COLO_DO for our new naming)
    const COLO = env.COLO || env.COLO_DO

    if (!COLO) {
      return new Response(JSON.stringify({ error: 'COLO binding not configured' }, null, 2), {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      })
    }

    // /api endpoint - return latency and distance info
    if (pathname === '/api') {
      try {
        const workerColo = cf?.colo || 'UNKNOWN'
        const latitude = cf?.latitude ? parseFloat(cf.latitude) : 0
        const longitude = cf?.longitude ? parseFloat(cf.longitude) : 0
        const { country, region, city, asn, asOrganization: isp, metroCode, postalCode } = cf || {}
        const visitorLatencyToWorker = cf?.clientTcpRtt

        const visitor = { latitude, longitude, country, region, city, asn, isp, metroCode, postalCode }

        // Use local data for locations
        const locations = Object.values(COLOS).map(c => ({
          iata: c.iata,
          lat: c.lat,
          lon: c.lon,
          cca2: c.country,
          region: c.region,
          city: c.city,
        }))

        // Use the Worker's colo as the target - this ensures DOs are created locally
        // When you hit cdg.colo.do and the Worker runs in CDG, we want a DO in CDG
        const targetColo = workerColo

        // Create registry to use newUniqueId() instead of idFromName()
        // This creates DOs in the CURRENT Worker's colo, not a deterministic global location
        const registry = createDORegistry(COLO, {
          indexDO: env.DO_REGISTRY,
        })

        // Get or create stub - newUniqueId() places DO in current Worker's colo
        const start = Date.now()
        let doColo = targetColo
        let workerLatencyToDurable = 0
        let registryTier: string = 'unknown'
        try {
          const result = await registry.getStubWithResult(targetColo, undefined, { request: req })
          registryTier = result.tier
          const stub = result.stub
          doColo = await stub.fetch('https://colo.do').then(res => res.text())
          workerLatencyToDurable = Date.now() - start
        } catch {
          // DO fetch failed - use target colo as fallback
          workerLatencyToDurable = Date.now() - start
        }

      // Find location info
      const workerLocation = locations.find(loc => loc.iata === workerColo) || null
      const durableLocation = locations.find(loc => loc.iata === doColo) || null
      const requestedLocation = locations.find(loc => loc.iata === targetColo) || null

      // Check if DO is running where we requested (auto-discovery)
      const coloMatch = targetColo === doColo
      const canHostDO = coloMatch // If requested == actual, this colo can host DOs

      // Calculate distances
      let visitorDistanceToWorker = 0
      let workerDistanceToDurable = 0
      let visitorDistanceToDurable = 0

      if (workerLocation) {
        visitorDistanceToWorker = Math.round(
          getDistance(latitude, longitude, workerLocation.lat, workerLocation.lon) / 1000
        )
      }
      if (workerLocation && durableLocation) {
        workerDistanceToDurable = Math.round(
          getDistance(workerLocation.lat, workerLocation.lon, durableLocation.lat, durableLocation.lon) / 1000
        )
      }
      if (durableLocation) {
        visitorDistanceToDurable = Math.round(
          getDistance(latitude, longitude, durableLocation.lat, durableLocation.lon) / 1000
        )
      }

      // Sanitize header values - strip any control characters
      const sanitizedDoColo = String(doColo || 'UNKNOWN').replace(/[\x00-\x1F\x7F]/g, '').trim()

      const responseData = {
        // Colo discovery info
        workerColo,
        actualColo: doColo,
        coloMatch,
        canHostDO,
        registryTier, // l1-cache, l2-index, or l3-created (newUniqueId)
        // Latency measurements
        visitorLatencyToWorker,
        workerLatencyToDurable,
        // Distance measurements (km)
        visitorDistanceToWorker,
        workerDistanceToDurable,
        visitorDistanceToDurable,
        // Location details
        visitor,
        workerLocation,
        durableLocation,
      }

      return new Response(JSON.stringify(responseData, null, 2), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-worker-colo': workerColo,
          'x-actual-colo': sanitizedDoColo,
          'x-colo-match': String(coloMatch),
          'x-registry-tier': registryTier,
          'x-do-latency': String(workerLatencyToDurable || 0),
          'x-visitor-latency': String(visitorLatencyToWorker ?? 0),
        },
      })
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error'
      return new Response(
        JSON.stringify({ error: errorMessage, stack: e instanceof Error ? e.stack : undefined }, null, 2),
        { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } }
      )
    }
  }

    // New API endpoints (extensions to original)
    if (pathname === '/api/colos' || pathname === '/api/colos/') {
      const url = new URL(req.url)
      const regionFilter = url.searchParams.get('region')
      const doOnly = url.searchParams.get('do') === 'true'

      let colosList = Object.values(COLOS)
      if (regionFilter && isValidRegion(regionFilter)) {
        colosList = getColosByRegion(regionFilter)
      }
      if (doOnly) {
        colosList = colosList.filter(c => c.hasDO)
      }

      return new Response(JSON.stringify({ colos: colosList }, null, 2), {
        headers: { 'content-type': 'application/json; charset=utf-8' },
      })
    }

    // Discovery endpoint - creates a NEW DO with newUniqueId() to test if this colo can host DOs
    // This is the WDOL approach: fresh DO every time, register if colo matches
    if (pathname === '/discover' || pathname === '/discover/') {
      const workerColo = cf?.colo || 'UNKNOWN'

      // Create a NEW DO with newUniqueId() - this places it in the current Worker's colo
      const newId = COLO.newUniqueId()
      const stub = COLO.get(newId)

      const start = Date.now()
      let actualColo = 'UNKNOWN'
      try {
        actualColo = await stub.fetch('https://colo.do').then(res => res.text())
      } catch (e) {
        return new Response(JSON.stringify({
          error: 'Failed to reach DO',
          workerColo,
          message: e instanceof Error ? e.message : 'Unknown error',
        }, null, 2), {
          status: 500,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        })
      }
      const latencyMs = Date.now() - start

      const canHostDO = workerColo === actualColo
      let registered = false

      // If this colo can host DOs, register it
      if (canHostDO && env.DO_REGISTRY) {
        try {
          const registryId = env.DO_REGISTRY.idFromName('index')
          const registry = env.DO_REGISTRY.get(registryId)

          await registry.fetch('https://internal/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              namespace: 'COLO',
              name: workerColo,
              id: newId.toString(),
              colo: workerColo,
              createdAt: Date.now(),
              lastAccessedAt: Date.now(),
              metadata: {
                city: colos[workerColo.toLowerCase()] || workerColo,
                canHostDO: true,
                discoveredAt: new Date().toISOString(),
                discoveryMethod: 'newUniqueId',
              },
            }),
          })
          registered = true
          console.log(`[COLO DISCOVERED] ${workerColo} can host Durable Objects`)
        } catch (e) {
          console.error('[COLO REGISTRY ERROR]', e instanceof Error ? e.message : e)
        }
      }

      return new Response(JSON.stringify({
        workerColo,
        actualColo,
        canHostDO,
        registered,
        latencyMs,
        doId: newId.toString(),
        city: colos[workerColo.toLowerCase()] || workerColo,
      }, null, 2), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-worker-colo': workerColo,
          'x-actual-colo': actualColo,
          'x-can-host-do': String(canHostDO),
        },
      })
    }

    // Registry API
    if (pathname.startsWith('/registry') && env.DO_REGISTRY) {
      const registryId = env.DO_REGISTRY.idFromName('index')
      const stub = env.DO_REGISTRY.get(registryId)
      const registryPath = pathname.replace('/registry', '') || '/'
      const forwardUrl = new URL(req.url)
      forwardUrl.pathname = registryPath
      return stub.fetch(new Request(forwardUrl.toString(), req))
    }

    // Service API
    if (pathname.startsWith('/service') && env.COLO_SERVICE) {
      const serviceId = env.COLO_SERVICE.idFromName('global')
      const stub = env.COLO_SERVICE.get(serviceId)
      const servicePath = pathname.replace('/service', '') || '/'
      const forwardUrl = new URL(req.url)
      forwardUrl.pathname = servicePath
      return stub.fetch(new Request(forwardUrl.toString(), req))
    }

    // Proxy all other requests through the colo DO
    // If subdomain specifies a colo (e.g., lhr.colo.do), use that colo's DO from registry
    // Otherwise use the Worker's colo
    const workerColo = cf?.colo || 'ORD'
    const targetColo = colo?.toUpperCase() || workerColo

    // Look up the target colo's DO from the registry
    // The registry stores DOs by colo name, created with newUniqueId() in that colo
    if (env.DO_REGISTRY) {
      try {
        const registryId = env.DO_REGISTRY.idFromName('index')
        const registryStub = env.DO_REGISTRY.get(registryId)

        // Look up the DO for the target colo
        const lookupRes = await registryStub.fetch(
          `https://internal/lookup/COLO/${encodeURIComponent(targetColo)}`
        )

        if (lookupRes.ok) {
          const entry = await lookupRes.json() as { id: string; colo: string }
          // Use idFromString with the registered DO ID
          const doId = COLO.idFromString(entry.id)
          const stub = COLO.get(doId)
          const doReq = new Request(req.url, req)
          doReq.headers.set('X-Requested-Colo', targetColo)
          return stub.fetch(doReq)
        }
      } catch {
        // Registry lookup failed, fall through to fallback
      }
    }

    // Fallback: use idFromName for unregistered colos
    // This will route to wherever CF places the DO (often ORD)
    const stub = COLO.get(COLO.idFromName(targetColo))
    const doReq = new Request(req.url, req)
    doReq.headers.set('X-Requested-Colo', targetColo)
    return stub.fetch(doReq)
  },
}

/**
 * Colo Durable Object - proxies requests from specific colos
 *
 * Auto-discovery pattern (like WDOL):
 * - DO discovers its actual colo via workers.cloudflare.com/cf.json
 * - If requestedColo === actualColo, registers in DORegistry (this colo can host DOs)
 * - Always returns both requestedColo and actualColo for transparency
 * - New DO-capable colos automatically appear when Cloudflare adds support
 */
export class Colo {
  private colo: string = 'UNKNOWN'
  private env: Env

  constructor(private state: DurableObjectState, env: Env) {
    this.env = env
    state.blockConcurrencyWhile(async () => {
      try {
        const { colo } = await fetch('https://workers.cloudflare.com/cf.json').then(res => res.json()) as { colo: string }
        this.colo = colo
      } catch {
        this.colo = 'UNKNOWN'
      }
    })
  }

  /**
   * Register this DO in the registry if it's running in the requested colo.
   * This is how we auto-discover DO-capable colos.
   *
   * IMPORTANT: This is fire-and-forget, never blocks the main request.
   * Always tries to register - registry handles upserts gracefully.
   */
  private maybeRegister(requestedColo: string): void {
    // Skip if no registry binding
    if (!this.env.DO_REGISTRY) return

    // Only register if this DO is running in the requested colo
    // (This proves this colo can host DOs)
    if (this.colo !== requestedColo) return

    // Fire and forget - use DO's waitUntil to run in background
    // Always try to register - registry upsert handles duplicates
    this.state.waitUntil((async () => {
      try {
        const registryId = this.env.DO_REGISTRY!.idFromName('index')
        const registry = this.env.DO_REGISTRY!.get(registryId)

        await registry.fetch('https://internal/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            namespace: 'COLO',
            name: this.colo,
            id: this.state.id.toString(),
            colo: this.colo,
            createdAt: Date.now(),
            lastAccessedAt: Date.now(),
            metadata: {
              city: colos[this.colo.toLowerCase()] || this.colo,
              canHostDO: true,
              discoveredAt: new Date().toISOString(),
            },
          }),
        })
        console.log(`[COLO DISCOVERED] ${this.colo} can host Durable Objects`)
      } catch (e) {
        console.error('[COLO REGISTRY ERROR]', e instanceof Error ? e.message : e)
      }
    })())
  }

  async fetch(req: Request): Promise<Response> {
    const { pathname, search } = new URL(req.url)

    // Extract the requested colo from the request header (set by worker)
    const requestedColo = req.headers.get('X-Requested-Colo') || this.colo

    // Simple colo check - return just the colo name for root path
    if (pathname === '/' && !search) {
      return new Response(this.colo)
    }

    // Try to register if this colo can host DOs (fire-and-forget, never blocks)
    this.maybeRegister(requestedColo)

    // Get user context if CTX binding is available
    let user: unknown = undefined
    if (this.env.CTX) {
      try {
        const ctxResponse = await this.env.CTX.fetch(req)
        const ctxData = await ctxResponse.json() as Record<string, unknown>
        user = ctxData.user
      } catch {
        // CTX not available or error
      }
    }

    // Proxy the request to the target URL
    // pathname is like /workers.cloudflare.com/cf.json
    const targetUrl = 'https:/' + pathname + search
    const start = Date.now()
    let res: Response
    let error: string | undefined

    try {
      res = await fetch(targetUrl)
    } catch (e) {
      error = e instanceof Error ? e.message : 'Fetch failed'
      return new Response(
        JSON.stringify({
          api,
          error,
          requestedColo,
          actualColo: this.colo,
          coloMatch: requestedColo === this.colo,
          colo: { iata: this.colo, city: colos[this.colo.toLowerCase()] },
        }, null, 2),
        { headers: { 'content-type': 'application/json; charset=utf-8' }, status: 502 }
      )
    }

    const responseTime = Date.now() - start
    const status = res.status
    const headers = Object.fromEntries(res.headers)

    let data: unknown
    const text = await res.text()
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }

    const coloInfo = {
      iata: this.colo,
      city: colos[this.colo.toLowerCase()] || this.colo,
      requested: requestedColo,
      actual: this.colo,
      match: requestedColo === this.colo,
    }

    // Build locations map organized by region
    const locations = buildLocationsByRegion(pathname, search)

    return new Response(
      JSON.stringify({ api, error, colo: coloInfo, responseTime, status, locations, headers, data, user }, null, 2),
      { headers: { 'content-type': 'application/json; charset=utf-8' } }
    )
  }
}

// Export ColoDO as the primary class name (matches wrangler.toml bindings)
export { Colo as ColoDO }

