# Durable Object Colo Analysis

**Date:** 2026-01-26

## Summary

This analysis tested all 278 Cloudflare Worker colos to discover which ones actually host Durable Objects.

### Key Findings

| Metric | WDOL Claims | Actually Observed |
|--------|-------------|-------------------|
| Total Worker Colos | 278 | 278 |
| DO-capable Colos | 32 | 24 |

## 24 Active DO Colos

| Region | Colos | Route Count |
|--------|-------|-------------|
| **North America** | ORD, IAD, EWR, ATL, MIA, DFW, DEN, SEA, LAX, SJC | 10 colos |
| **Europe** | LHR, AMS, FRA, CDG, MXP, MRS, ARN, WAW, VIE, PRG | 10 colos |
| **Asia-Pacific** | SIN, HKG, KIX, ICN | 4 colos |
| **Oceania** | (none - routes to Asia) | 0 colos |

### Traffic Distribution

ORD (Chicago) handles **63% of all DO traffic** (175 out of 278 colos route there).

| DO Colo | Routes | Percentage |
|---------|--------|------------|
| ORD | 175 | 63.0% |
| SIN | 15 | 5.4% |
| LHR | 12 | 4.3% |
| ARN, EWR, FRA, IAD, WAW | 7 each | 2.5% each |
| AMS, HKG | 6 each | 2.2% each |
| PRG | 5 | 1.8% |
| ATL | 4 | 1.4% |
| DFW, SJC | 3 each | 1.1% each |
| DEN, LAX, MXP, SEA | 2 each | 0.7% each |
| CDG, ICN, KIX, MIA, MRS, VIE | 1 each | 0.4% each |

## 8 Missing DO Colos

These colos are listed in WDOL as DO-capable but actually route to other colos:

| Colo | Expected Region | Routes To |
|------|-----------------|-----------|
| AKL | Oceania | HKG |
| BNE | Oceania | HKG |
| MEL | Oceania | SIN |
| SYD | Oceania | SIN |
| NRT | Asia | SIN |
| LIS | Europe | AMS |
| MAD | Europe | AMS |
| ZRH | Europe | FRA |

## Regions Without Local DO Hosting

- **Oceania** - All traffic routes to Asia (SIN/HKG)
- **Africa** - Routes to ORD or LHR
- **South America** - Routes to ORD or EWR/IAD
- **Middle East** - Routes to ORD or FRA

## Methodology

1. Used WDOL data from https://where.durableobjects.live/api/v3/data.json
2. Tested each colo via https://{colo}.colo.do/workers.cloudflare.com/cf.json
3. The DO fetches cf.json and reports its actual running location
4. Tests were run from a single location (MSP/Minneapolis)

## Files

- `colo-test-results.csv` - Full mapping of 278 colos to their DO colos
- `wdol-data.json` - Raw WDOL data
- `expected-do-colos.txt` - 32 expected DO colos from WDOL
- `discovered-do-colos.txt` - 24 actually discovered DO colos

## Notes

- Testing from a single location may not capture all possible DO placements
- DO routing may vary based on load, time of day, or other factors
- WDOL data represents historical observations which may differ from current state
