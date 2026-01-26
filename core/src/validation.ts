/**
 * Input Validation for colo.do
 *
 * Provides validation utilities for public APIs to ensure
 * safe and consistent input handling.
 */

import { getAllColos, type ColoRegion } from './colos.js'

// ============================================================================
// Constants
// ============================================================================

const MAX_NAME_LENGTH = 256
const MAX_NAMESPACE_LENGTH = 256

/**
 * Valid region identifiers
 */
export const VALID_REGIONS = [
  'wnam',
  'enam',
  'weur',
  'eeur',
  'apac',
  'oc',
  'sam',
  'afr',
  'me',
] as const

export type ValidRegion = (typeof VALID_REGIONS)[number]

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error thrown when input validation fails
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if a string is a valid region
 *
 * @param region - The string to check
 * @returns true if the string is a valid ColoRegion
 */
export function isValidRegion(region: string): region is ValidRegion {
  return (VALID_REGIONS as readonly string[]).includes(region)
}

/**
 * Type guard to check if a string is a valid colo code
 *
 * @param colo - The string to check (case-insensitive)
 * @returns true if the string is a valid IATA colo code
 */
export function isValidColo(colo: string): boolean {
  const allColos = getAllColos()
  return allColos.includes(colo.toUpperCase())
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate a namespace string
 *
 * @param namespace - The namespace to validate
 * @throws {ValidationError} If the namespace is invalid
 */
export function validateNamespace(namespace: string): void {
  if (!namespace || namespace.trim() === '') {
    throw new ValidationError('Namespace cannot be empty')
  }
  if (namespace.length > MAX_NAMESPACE_LENGTH) {
    throw new ValidationError(
      `Namespace exceeds max length of ${MAX_NAMESPACE_LENGTH}`
    )
  }
}

/**
 * Validate a name string
 *
 * @param name - The name to validate
 * @throws {ValidationError} If the name is invalid
 */
export function validateName(name: string): void {
  if (!name || name.trim() === '') {
    throw new ValidationError('Name cannot be empty')
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new ValidationError(`Name exceeds max length of ${MAX_NAME_LENGTH}`)
  }
}

/**
 * Validate a colo code
 *
 * @param colo - The colo code to validate (case-insensitive)
 * @throws {ValidationError} If the colo code is invalid
 */
export function validateColo(colo: string): void {
  if (!colo || colo.trim() === '') {
    throw new ValidationError('Colo cannot be empty')
  }
  if (!isValidColo(colo)) {
    throw new ValidationError(`Invalid colo: ${colo}`)
  }
}

/**
 * Validate a region identifier
 *
 * @param region - The region to validate
 * @throws {ValidationError} If the region is invalid
 */
export function validateRegion(region: string): void {
  if (!region || region.trim() === '') {
    throw new ValidationError('Region cannot be empty')
  }
  if (!isValidRegion(region)) {
    throw new ValidationError(
      `Invalid region: ${region}. Valid regions are: ${VALID_REGIONS.join(', ')}`
    )
  }
}
