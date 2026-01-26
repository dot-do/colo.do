# @dotdo/colo

Location-aware Durable Objects for Cloudflare Workers.

Create, target, and manage Durable Objects in specific Cloudflare colocations.

## Installation

```bash
npm install @dotdo/colo
```

## Features

- **Target specific colos** - Create DOs in LAX, IAD, LHR, or any other Cloudflare colo
- **Find nearest colo** - Route requests to the nearest DO from a list of replicas
- **Calculate distances** - Get distance and latency estimates between colos
- **Colo-aware DOs** - Base class that tracks location and provides migration hints
- **Sharding** - Distribute data across colos with consistent hashing

## Quick Start

```typescript
import { createInColo, findNearestColo, createReplicas } from '@dotdo/colo'

// Create a DO in a specific colo
const stub = createInColo(env.MY_DO, {
  colo: 'LAX',
  id: 'my-instance'
})

// Create replicas across multiple colos
const replicas = createReplicas(env.MY_DO, {
  id: 'shared-data',
  colos: ['IAD', 'ORD', 'SFO', 'LHR']
})

// Route to the nearest replica
const nearest = findNearestColo(request, ['IAD', 'ORD', 'SFO', 'LHR'])
const result = await replicas[nearest].getData()
```

## API

### Location Detection

```typescript
import { getLocation, getCurrentColo } from '@dotdo/colo'

// Get full location info from a request
const location = getLocation(request)
console.log(location.colo)      // 'IAD'
console.log(location.city)      // 'Ashburn'
console.log(location.country)   // 'US'

// Just get the colo
const colo = getCurrentColo(request)
```

### Distance & Latency

```typescript
import { coloDistance, estimateLatency, sortByDistance, nearestColo } from '@dotdo/colo'

// Distance between colos in kilometers
const km = coloDistance('IAD', 'LAX')  // ~3700

// Estimated round-trip latency in milliseconds
const ms = estimateLatency('IAD', 'LAX')  // ~42

// Sort colos by distance from a reference point
const sorted = sortByDistance('IAD', ['LAX', 'ORD', 'SFO', 'LHR'])
// [{ colo: 'ORD', distance: 956, latency: 15 }, ...]

// Find nearest colo from a list
const nearest = nearestColo('IAD', ['LAX', 'ORD', 'SFO'])  // 'ORD'
```

### DO Targeting

```typescript
import { targetColo, createInColo, createReplicas } from '@dotdo/colo'

// Get the name to use for idFromName
const { name, colo } = targetColo({ colo: 'LAX', id: 'my-instance' })
const doId = env.MY_DO.idFromName(name)

// Or create the stub directly
const stub = createInColo(env.MY_DO, { colo: 'LAX', id: 'my-instance' })

// Create replicas in multiple colos
const replicas = createReplicas(env.MY_DO, {
  id: 'my-data',
  colos: ['IAD', 'ORD', 'SFO', 'LHR']
})
```

### Sharding

```typescript
import { getShard } from '@dotdo/colo'

// Get the shard for a key
const { colo, shardId, name } = getShard({
  key: 'user-12345',
  colos: ['IAD', 'ORD', 'SFO', 'LHR'],
  shardsPerColo: 16
})

const stub = env.USER_DO.get(env.USER_DO.idFromName(name))
```

### Colo-Aware DO Base Class

```typescript
import { ColoAwareDO, type ColoContext } from '@dotdo/colo'

export class MyDO extends ColoAwareDO {
  async fetch(request: Request): Promise<Response> {
    const ctx = this.getColoContext(request)

    console.log(`DO running in ${ctx.colo}`)
    console.log(`Worker called from ${ctx.workerColo}`)
    console.log(`Estimated latency: ${ctx.latencyMs}ms`)

    return new Response(JSON.stringify(ctx))
  }
}
```

## Colo Data

```typescript
import { COLOS, getColo, getAllColos, getColosByRegion, getDOColos } from '@dotdo/colo'

// Get info for a specific colo
const lax = getColo('LAX')
// { iata: 'LAX', city: 'Los Angeles', country: 'US', region: 'wnam', lat: 33.94, lon: -118.41, hasDO: true }

// Get all IATA codes
const allColos = getAllColos()  // ['SJC', 'LAX', 'SEA', ...]

// Get colos in a region
const westCoast = getColosByRegion('wnam')

// Get only colos that support DOs
const doColos = getDOColos()
```

## Live API

Visit [colo.do](https://colo.do) for a live API:

- `GET /api` - Your location info and nearest colos
- `GET /api/colos` - List all colos
- `GET /api/colos/LAX` - Get specific colo info
- `GET /api/nearest?colos=IAD,ORD,SFO` - Find nearest from list
- `GET /api/distance?from=IAD&to=LAX` - Calculate distance

## License

MIT
