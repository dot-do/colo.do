/**
 * colo.do - Location-aware Durable Objects managed service
 *
 * This is the managed service package that uses @dotdo/colo.
 * Re-exports all library functionality plus managed service features.
 *
 * @packageDocumentation
 */

// Re-export everything from @dotdo/colo
export * from '@dotdo/colo'

// Worker export for deployment
export { default, ColoDO } from '@dotdo/colo/worker'
