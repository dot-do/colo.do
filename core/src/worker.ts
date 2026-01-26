/**
 * colo.do Worker
 *
 * Proxy worker for routing requests to DOs in specific colos.
 * Deploy this to get the colo.do API at your domain.
 *
 * Routes (subdomain-based - primary API):
 * - GET {colo}.colo.do/* - Proxy to DO in specific colo
 * - Example: lax.colo.do/query → routes to LAX colo
 *
 * Routes (path-based - alternative):
 * - GET /api - Get colo information and latencies
 * - GET /api/colos - List all colos
 * - GET /api/colos/:colo - Get info for a specific colo
 * - GET /api/nearest?colos=IAD,ORD,SFO - Find nearest from list
 * - GET /api/distance?from=IAD&to=LAX - Calculate distance
 * - GET /:colo/* - Proxy to DO in specific colo (fallback)
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
} from './location.js'

// Re-export DOs for wrangler bindings
export { DORegistryDO } from './do-registry.js'
export { ColoServiceDO } from './colo-service.js'

export interface Env {
  // Optional: A DO namespace for testing colo placement
  COLO_DO?: DurableObjectNamespace
  // Optional: Colo Service DO for programmatic DO management
  COLO_SERVICE?: DurableObjectNamespace
}

/**
 * Main worker fetch handler
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const hostname = url.hostname

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    // Get location info
    const location = getLocation(request)

    try {
      // ================================================================
      // Subdomain-based routing: {colo}.colo.do/*
      // Examples:
      //   lax.colo.do/query → LAX
      //   iad.colo.do/api → IAD
      //   london.colo.do/data → LHR (city alias)
      // ================================================================
      const subdomainColo = parseSubdomainColo(hostname)
      if (subdomainColo && env.COLO_DO) {
        return handleColoDORequest(
          request,
          env.COLO_DO,
          subdomainColo,
          location.colo,
          path,
          corsHeaders
        )
      }
      // API routes
      if (path === '/api' || path === '/api/') {
        return json({
          colo: location.colo,
          coloInfo: location.coloInfo,
          visitor: {
            latitude: location.latitude,
            longitude: location.longitude,
            country: location.country,
            city: location.city,
            region: location.region,
            timezone: location.timezone,
          },
          nearestColos: sortByDistance(location.colo).slice(0, 10),
        }, corsHeaders)
      }

      // Seed endpoint - warm up cluster DO in this colo
      // Use with https://tools.bunny.net/http-test?query=https://colo.do/api/seed
      if (path === '/api/seed') {
        const cf = (request as unknown as { cf?: IncomingRequestCfProperties }).cf
        const currentColo = cf?.colo

        return json({
          seeded: true,
          colo: currentColo,
          timestamp: Date.now(),
          message: currentColo
            ? `Cluster DO seeded in ${currentColo}`
            : 'Request from unknown colo',
        }, corsHeaders)
      }

      if (path === '/api/colos' || path === '/api/colos/') {
        const region = url.searchParams.get('region')
        const doOnly = url.searchParams.get('do') === 'true'

        let colos = Object.values(COLOS)

        if (region) {
          if (!isValidRegion(region)) {
            return json(
              {
                error: `Invalid region: ${region}. Valid regions are: wnam, enam, weur, eeur, apac, oc, sam, afr, me`,
              },
              corsHeaders,
              400
            )
          }
          colos = getColosByRegion(region)
        }
        if (doOnly) {
          colos = colos.filter(c => c.hasDO)
        }

        return json({ colos }, corsHeaders)
      }

      // Get specific colo info
      const coloMatch = path.match(/^\/api\/colos\/([A-Z]{3})$/i)
      if (coloMatch) {
        const colo = getColo(coloMatch[1])
        if (!colo) {
          return json({ error: 'Colo not found' }, corsHeaders, 404)
        }

        const distance = coloDistance(location.colo, colo.iata)
        const latency = estimateLatency(location.colo, colo.iata)

        return json({
          ...colo,
          fromColo: location.colo,
          distance,
          latency,
        }, corsHeaders)
      }

      // Find nearest colo
      if (path === '/api/nearest') {
        const colosParam = url.searchParams.get('colos')
        if (!colosParam) {
          return json({ error: 'colos parameter required' }, corsHeaders, 400)
        }

        const candidates = colosParam.split(',').map(c => c.trim().toUpperCase())
        const nearest = nearestColo(location.colo, candidates)

        if (!nearest) {
          return json({ error: 'No valid colos found' }, corsHeaders, 404)
        }

        return json({
          nearest,
          nearestInfo: getColo(nearest),
          fromColo: location.colo,
          distance: coloDistance(location.colo, nearest),
          latency: estimateLatency(location.colo, nearest),
          candidates: sortByDistance(location.colo, candidates),
        }, corsHeaders)
      }

      // Calculate distance
      if (path === '/api/distance') {
        const from = url.searchParams.get('from')
        const to = url.searchParams.get('to')

        if (!from || !to) {
          return json({ error: 'from and to parameters required' }, corsHeaders, 400)
        }

        const distance = coloDistance(from, to)
        const latency = estimateLatency(from, to)

        if (distance === undefined) {
          return json({ error: 'Invalid colo codes' }, corsHeaders, 400)
        }

        return json({
          from: getColo(from),
          to: getColo(to),
          distance,
          latency,
        }, corsHeaders)
      }

      // Colo Service API - programmatic DO management
      // Format: /service/*
      if (path.startsWith('/service') && env.COLO_SERVICE) {
        const serviceId = env.COLO_SERVICE.idFromName('global')
        const stub = env.COLO_SERVICE.get(serviceId)

        const servicePath = path.replace('/service', '') || '/'
        const forwardUrl = new URL(request.url)
        forwardUrl.pathname = servicePath

        const forwardRequest = new Request(forwardUrl.toString(), {
          method: request.method,
          headers: request.headers,
          body: request.body,
        })

        const response = await stub.fetch(forwardRequest)

        // Add CORS headers
        const newHeaders = new Headers(response.headers)
        for (const [key, value] of Object.entries(corsHeaders)) {
          newHeaders.set(key, value)
        }

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        })
      }

      // Proxy to DO in specific colo
      // Format: /:colo/:namespace/:id/*
      const proxyMatch = path.match(/^\/([A-Z]{3})\/?(.*)$/i)
      if (proxyMatch && env.COLO_DO) {
        const targetColo = proxyMatch[1].toUpperCase()
        const remainder = proxyMatch[2] || ''

        const coloInfo = getColo(targetColo)
        if (!coloInfo) {
          return json({ error: `Unknown colo: ${targetColo}` }, corsHeaders, 404)
        }

        // Create DO ID targeting the specific colo
        const doName = `colo:${targetColo}`
        const doId = env.COLO_DO.idFromName(doName)
        const stub = env.COLO_DO.get(doId)

        // Forward request with colo info headers + timestamp for RTT measurement
        const headers = new Headers(request.headers)
        headers.set('X-Worker-Colo', location.colo)
        headers.set('X-Target-Colo', targetColo)
        headers.set('X-Request-Timestamp', Date.now().toString())

        const forwardUrl = new URL(request.url)
        forwardUrl.pathname = '/' + remainder

        const forwardRequest = new Request(forwardUrl.toString(), {
          method: request.method,
          headers,
          body: request.body,
        })

        return stub.fetch(forwardRequest)
      }

      // Homepage / documentation
      if (path === '/' || path === '') {
        return new Response(getHomepage(location), {
          headers: {
            'Content-Type': 'text/html',
            ...corsHeaders,
          },
        })
      }

      return json({ error: 'Not found' }, corsHeaders, 404)

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return json({ error: message }, corsHeaders, 500)
    }
  },
}

/**
 * JSON response helper
 */
function json(data: unknown, headers: Record<string, string>, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  })
}

/**
 * Simple homepage HTML
 */
function getHomepage(location: ReturnType<typeof getLocation>): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>colo.do - Location-aware Durable Objects</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; }
    h1 { color: #f38020; }
    code { background: #f4f4f4; padding: 0.2rem 0.4rem; border-radius: 4px; }
    pre { background: #f4f4f4; padding: 1rem; border-radius: 8px; overflow-x: auto; }
    .colo { font-size: 2rem; color: #f38020; font-weight: bold; }
    a { color: #f38020; }
  </style>
</head>
<body>
  <h1>colo.do</h1>
  <p>Location-aware Durable Objects for Cloudflare Workers.</p>

  <p>You are currently being served from: <span class="colo">${location.colo}</span></p>
  ${location.coloInfo ? `<p>${location.coloInfo.city}, ${location.coloInfo.country}</p>` : ''}

  <h2>API Endpoints</h2>
  <ul>
    <li><code>GET <a href="/api">/api</a></code> - Your location info and nearest colos</li>
    <li><code>GET <a href="/api/colos">/api/colos</a></code> - List all colos</li>
    <li><code>GET <a href="/api/colos/LAX">/api/colos/:colo</a></code> - Get specific colo info</li>
    <li><code>GET <a href="/api/nearest?colos=IAD,ORD,SFO,LHR">/api/nearest?colos=IAD,ORD,SFO</a></code> - Find nearest from list</li>
    <li><code>GET <a href="/api/distance?from=IAD&to=LAX">/api/distance?from=IAD&to=LAX</a></code> - Calculate distance</li>
  </ul>

  <h2>Installation</h2>
  <pre>npm install colo.do</pre>

  <h2>Usage</h2>
  <pre>import { createInColo, findNearestColo } from 'colo.do'

// Create a DO in LAX
const stub = createInColo(env.MY_DO, {
  colo: 'LAX',
  id: 'my-instance'
})

// Find nearest colo from a request
const nearest = findNearestColo(request, ['IAD', 'ORD', 'SFO'])</pre>

  <h2>Links</h2>
  <ul>
    <li><a href="https://github.com/dot-do/colo.do">GitHub</a></li>
    <li><a href="https://npmjs.com/package/colo.do">npm</a></li>
    <li><a href="https://rpc.do">rpc.do</a> - Type-safe RPC for Durable Objects</li>
  </ul>
</body>
</html>`
}

/**
 * Simple Colo DO for testing colo placement
 *
 * Note: DOs don't have direct access to their own colo location.
 * The cf.colo on the request shows where the request originated,
 * not where the DO is running.
 *
 * To verify placement, measure round-trip latency - DOs closer
 * to the request origin will have lower latency.
 */
export class ColoDO implements DurableObject {
  private state: DurableObjectState
  private initTime: number

  constructor(state: DurableObjectState) {
    this.state = state
    this.initTime = Date.now()
  }

  async fetch(request: Request): Promise<Response> {
    const startTime = Date.now()
    const cf = (request as unknown as { cf?: IncomingRequestCfProperties }).cf

    // Read from storage to ensure DO is fully initialized
    await this.state.storage.get('_ping')

    const processingTime = Date.now() - startTime
    const workerColo = request.headers.get('X-Worker-Colo')
    const targetColo = request.headers.get('X-Target-Colo')
    const requestTimestamp = request.headers.get('X-Request-Timestamp')

    // Calculate round-trip time if timestamp was sent
    const roundTripMs = requestTimestamp
      ? Date.now() - parseInt(requestTimestamp, 10)
      : undefined

    return new Response(JSON.stringify({
      // DO info
      doId: this.state.id.toString(),
      doName: this.state.id.name ?? null,
      initTime: this.initTime,

      // Request info
      requestColo: cf?.colo ?? 'UNKNOWN',
      workerColo,
      targetColo,
      targetColoInfo: targetColo ? getColo(targetColo) : undefined,

      // Timing (helps verify placement - lower = closer)
      processingMs: processingTime,
      roundTripMs,

      // Distance calculations (if worker colo is known)
      distance: workerColo && targetColo ? coloDistance(workerColo, targetColo) : undefined,
      estimatedLatency: workerColo && targetColo ? estimateLatency(workerColo, targetColo) : undefined,
    }, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'X-DO-Processing-Ms': processingTime.toString(),
      },
    })
  }
}

// Backwards compatibility alias for migration from 'Colo' to 'ColoDO'
export { ColoDO as Colo }

// ============================================================================
// Subdomain Routing Helpers
// ============================================================================

/**
 * City name to IATA code mapping for subdomain aliases
 */
const CITY_ALIASES: Record<string, string> = {
  // US Cities
  'losangeles': 'LAX',
  'la': 'LAX',
  'sanfrancisco': 'SFO',
  'sf': 'SFO',
  'seattle': 'SEA',
  'portland': 'PDX',
  'phoenix': 'PHX',
  'denver': 'DEN',
  'saltlakecity': 'SLC',
  'lasvegas': 'LAS',
  'vegas': 'LAS',
  'ashburn': 'IAD',
  'dc': 'IAD',
  'washington': 'IAD',
  'newark': 'EWR',
  'newyork': 'EWR',
  'ny': 'EWR',
  'nyc': 'EWR',
  'chicago': 'ORD',
  'atlanta': 'ATL',
  'dallas': 'DFW',
  'miami': 'MIA',
  'boston': 'BOS',
  'sanjose': 'SJC',

  // Canada
  'toronto': 'YYZ',
  'montreal': 'YUL',

  // Europe
  'london': 'LHR',
  'amsterdam': 'AMS',
  'frankfurt': 'FRA',
  'paris': 'CDG',
  'madrid': 'MAD',
  'milan': 'MXP',
  'dublin': 'DUB',
  'zurich': 'ZRH',
  'brussels': 'BRU',
  'copenhagen': 'CPH',
  'stockholm': 'ARN',
  'oslo': 'OSL',
  'helsinki': 'HEL',
  'warsaw': 'WAW',
  'prague': 'PRG',
  'vienna': 'VIE',
  'budapest': 'BUD',

  // Asia Pacific
  'tokyo': 'NRT',
  'hongkong': 'HKG',
  'hk': 'HKG',
  'singapore': 'SIN',
  'seoul': 'ICN',
  'mumbai': 'BOM',
  'delhi': 'DEL',
  'bangkok': 'BKK',
  'taipei': 'TPE',
  'kualalumpur': 'KUL',
  'kl': 'KUL',

  // Oceania
  'sydney': 'SYD',
  'melbourne': 'MEL',
  'auckland': 'AKL',

  // South America
  'saopaulo': 'GRU',
  'rio': 'GIG',
  'riodejaneiro': 'GIG',
  'buenosaires': 'EZE',
  'santiago': 'SCL',

  // Africa
  'johannesburg': 'JNB',
  'joburg': 'JNB',
  'capetown': 'CPT',

  // Middle East
  'dubai': 'DXB',
  'telaviv': 'TLV',
}

/**
 * Parse subdomain to extract colo IATA code
 *
 * Supports:
 * - Direct IATA: lax.colo.do → LAX
 * - City names: london.colo.do → LHR
 * - Case insensitive: LAX.colo.do → LAX
 *
 * @returns IATA code or undefined if not a colo subdomain
 */
function parseSubdomainColo(hostname: string): string | undefined {
  // Match patterns:
  // - {colo}.colo.do
  // - {colo}.colo-do.dotdo.workers.dev
  // - {colo}.localhost (for local dev)

  const patterns = [
    /^([a-z0-9-]+)\.colo\.do$/i,
    /^([a-z0-9-]+)\.colo-do\.dotdo\.workers\.dev$/i,
    /^([a-z0-9-]+)\.localhost$/i,
  ]

  for (const pattern of patterns) {
    const match = hostname.match(pattern)
    if (match) {
      const subdomain = match[1].toLowerCase()

      // Skip 'www' and 'api' subdomains
      if (subdomain === 'www' || subdomain === 'api') {
        return undefined
      }

      // Check if it's a direct IATA code (3 letters)
      if (/^[a-z]{3}$/i.test(subdomain)) {
        const iata = subdomain.toUpperCase()
        if (getColo(iata)) {
          return iata
        }
      }

      // Check city aliases
      const aliasIata = CITY_ALIASES[subdomain.replace(/-/g, '')]
      if (aliasIata) {
        return aliasIata
      }

      // Not a valid colo subdomain
      return undefined
    }
  }

  return undefined
}

/**
 * Handle a request routed to a specific colo via subdomain or path
 */
async function handleColoDORequest(
  request: Request,
  namespace: DurableObjectNamespace,
  targetColo: string,
  workerColo: string,
  path: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const coloInfo = getColo(targetColo)
  if (!coloInfo) {
    return new Response(JSON.stringify({ error: `Unknown colo: ${targetColo}` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }

  // Create DO ID targeting the specific colo
  const doName = `colo:${targetColo}`
  const doId = namespace.idFromName(doName)
  const stub = namespace.get(doId, { locationHint: coloInfo.region })

  // Forward request with colo info headers + timestamp for RTT measurement
  const headers = new Headers(request.headers)
  headers.set('X-Worker-Colo', workerColo)
  headers.set('X-Target-Colo', targetColo)
  headers.set('X-Request-Timestamp', Date.now().toString())

  const forwardUrl = new URL(request.url)
  forwardUrl.pathname = path

  const forwardRequest = new Request(forwardUrl.toString(), {
    method: request.method,
    headers,
    body: request.body,
  })

  const response = await stub.fetch(forwardRequest)

  // Add CORS headers to response
  const newHeaders = new Headers(response.headers)
  for (const [key, value] of Object.entries(corsHeaders)) {
    newHeaders.set(key, value)
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  })
}
