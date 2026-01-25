/**
 * colo.do Worker
 *
 * Proxy worker for routing requests to DOs in specific colos.
 * Deploy this to get the colo.do API at your domain.
 *
 * Routes:
 * - GET /api - Get colo information and latencies
 * - GET /api/colos - List all colos
 * - GET /api/colos/:colo - Get info for a specific colo
 * - GET /api/nearest?colos=IAD,ORD,SFO - Find nearest from list
 * - GET /api/distance?from=IAD&to=LAX - Calculate distance
 * - GET /:colo/* - Proxy to DO in specific colo
 */

import {
  COLOS,
  getColo,
  getAllColos,
  getColosByRegion,
  getDOColos,
} from './colos.js'
import {
  getLocation,
  sortByDistance,
  nearestColo,
  coloDistance,
  estimateLatency,
} from './location.js'

export interface Env {
  // Optional: A DO namespace for testing colo placement
  COLO_DO?: DurableObjectNamespace
}

/**
 * Main worker fetch handler
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

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

      if (path === '/api/colos' || path === '/api/colos/') {
        const region = url.searchParams.get('region')
        const doOnly = url.searchParams.get('do') === 'true'

        let colos = Object.values(COLOS)

        if (region) {
          colos = getColosByRegion(region as any)
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

        // Forward request with colo info header
        const headers = new Headers(request.headers)
        headers.set('X-Worker-Colo', location.colo)
        headers.set('X-Target-Colo', targetColo)

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
 */
export class ColoDO implements DurableObject {
  private state: DurableObjectState

  constructor(state: DurableObjectState) {
    this.state = state
  }

  async fetch(request: Request): Promise<Response> {
    const cf = (request as unknown as { cf?: IncomingRequestCfProperties }).cf
    const doColo = cf?.colo ?? 'UNKNOWN'
    const workerColo = request.headers.get('X-Worker-Colo')
    const targetColo = request.headers.get('X-Target-Colo')

    return new Response(JSON.stringify({
      doColo,
      workerColo,
      targetColo,
      coloInfo: getColo(doColo),
      distance: workerColo ? coloDistance(workerColo, doColo) : undefined,
      latency: workerColo ? estimateLatency(workerColo, doColo) : undefined,
    }, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
