/**
 * Self-Registering DO Pattern
 *
 * Instead of the Worker handling registration, the DO registers itself.
 * If registration fails, the DO sets an alarm to retry.
 *
 * Benefits:
 * - No worker-level state/buffering needed
 * - Survives worker restarts
 * - DO can retry indefinitely via alarm
 * - Eventually consistent but guaranteed
 *
 * @example
 * ```typescript
 * import { SelfRegisteringDO } from 'colo.do'
 *
 * export class MyDO extends SelfRegisteringDO {
 *   // Your methods here
 *   async getData() {
 *     return { hello: 'world' }
 *   }
 * }
 * ```
 */

import { RpcTarget } from 'capnweb'

// ============================================================================
// Types
// ============================================================================

export interface RegistrationConfig {
  /** Registry DO binding name in env */
  registryBinding: string
  /** R2 bucket binding name in env (for snapshot reads) */
  bucketBinding?: string
  /** This DO's namespace name (e.g., 'POSTGRES_DO') */
  namespace: string
  /** Retry delay in ms (default: 5000) */
  retryDelayMs?: number
  /** Max retries before giving up (default: 10, 0 = infinite) */
  maxRetries?: number
}

interface RegistrationState {
  /** Whether registration is complete */
  registered: boolean
  /** Number of registration attempts */
  attempts: number
  /** Last error message */
  lastError?: string
  /** When registration completed */
  registeredAt?: number
}

const REGISTRATION_KEY = '__colo_registration'
const DEFAULT_RETRY_DELAY = 5000
const DEFAULT_MAX_RETRIES = 10

// ============================================================================
// Self-Registering DO Base Class
// ============================================================================

/**
 * Base class for DOs that register themselves with the registry
 *
 * On first request, the DO attempts to register itself.
 * If registration fails, it sets an alarm to retry.
 */
export abstract class SelfRegisteringDO extends RpcTarget implements DurableObject {
  protected ctx: DurableObjectState
  protected env: Record<string, unknown>

  private _colo: string | null = null
  private _name: string | null = null
  private _registrationConfig: RegistrationConfig | null = null

  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    super()
    this.ctx = ctx
    this.env = env
  }

  /**
   * Override this to provide registration config
   * Return null to disable self-registration
   */
  protected getRegistrationConfig(): RegistrationConfig | null {
    return this._registrationConfig
  }

  /**
   * Set registration config (alternative to override)
   */
  protected setRegistrationConfig(config: RegistrationConfig): void {
    this._registrationConfig = config
  }

  /**
   * Get the colo where this DO is running
   */
  get colo(): string | undefined {
    return this._colo ?? undefined
  }

  /**
   * Get the registered name of this DO
   */
  get registeredName(): string | undefined {
    return this._name ?? undefined
  }

  // ==========================================================================
  // Registration Logic
  // ==========================================================================

  /**
   * Attempt to register this DO with the registry
   */
  private async attemptRegistration(): Promise<boolean> {
    const config = this.getRegistrationConfig()
    if (!config) return true // Registration disabled

    const state = await this.getRegistrationState()
    if (state.registered) return true // Already registered

    const registryDO = this.env[config.registryBinding] as DurableObjectNamespace | undefined
    if (!registryDO) {
      console.error(`Registry binding '${config.registryBinding}' not found`)
      return false
    }

    try {
      // Get our ID info from storage or generate
      let idInfo = await this.ctx.storage.get<{ id: string; name: string; colo: string }>('__colo_id_info')

      if (!idInfo) {
        // First time - we need the colo from a request
        // This should be set by detectColo in fetch()
        if (!this._colo) {
          // Can't register yet - need colo info
          return false
        }

        const random = crypto.randomUUID().slice(0, 8)
        const name = `${config.namespace.toLowerCase()}-${random}`
        const id = `${this._colo}:${name}:${Date.now().toString(36)}:${random}`

        idInfo = { id, name, colo: this._colo }
        await this.ctx.storage.put('__colo_id_info', idInfo)
      }

      this._name = idInfo.name
      this._colo = idInfo.colo

      // Call registry to register
      const stub = registryDO.get(registryDO.idFromName('global'))
      const response = await stub.fetch('http://registry/_rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'registerSelf',
          args: [{
            namespace: config.namespace,
            name: idInfo.name,
            id: idInfo.id,
            colo: idInfo.colo,
            createdAt: Date.now(),
          }],
        }),
      })

      if (!response.ok) {
        throw new Error(`Registry returned ${response.status}`)
      }

      // Success!
      await this.ctx.storage.put<RegistrationState>(REGISTRATION_KEY, {
        registered: true,
        attempts: state.attempts + 1,
        registeredAt: Date.now(),
      })

      return true

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      // Update state with failure
      const newState: RegistrationState = {
        registered: false,
        attempts: state.attempts + 1,
        lastError: message,
      }
      await this.ctx.storage.put(REGISTRATION_KEY, newState)

      // Schedule retry via alarm
      const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES
      if (maxRetries === 0 || newState.attempts < maxRetries) {
        const delay = config.retryDelayMs ?? DEFAULT_RETRY_DELAY
        // Exponential backoff with jitter
        const backoff = Math.min(delay * Math.pow(2, newState.attempts - 1), 60000)
        const jitter = Math.random() * 1000
        await this.ctx.storage.setAlarm(Date.now() + backoff + jitter)
      }

      console.error(`Registration attempt ${newState.attempts} failed: ${message}`)
      return false
    }
  }

  /**
   * Get current registration state
   */
  private async getRegistrationState(): Promise<RegistrationState> {
    const state = await this.ctx.storage.get<RegistrationState>(REGISTRATION_KEY)
    return state ?? { registered: false, attempts: 0 }
  }

  /**
   * Detect colo from request
   */
  private detectColo(request: Request): void {
    if (this._colo) return

    const cf = (request as unknown as { cf?: IncomingRequestCfProperties }).cf
    this._colo = cf?.colo ?? null
  }

  // ==========================================================================
  // DurableObject Methods
  // ==========================================================================

  /**
   * Handle fetch requests
   * Attempts registration on first request
   */
  async fetch(request: Request): Promise<Response> {
    this.detectColo(request)

    // Attempt registration (non-blocking after first success)
    const state = await this.getRegistrationState()
    if (!state.registered) {
      // Don't await - let it happen in background
      this.ctx.waitUntil(this.attemptRegistration())
    }

    // Delegate to subclass
    return this.handleFetch(request)
  }

  /**
   * Handle alarm (registration retry)
   */
  async alarm(): Promise<void> {
    const state = await this.getRegistrationState()
    if (!state.registered) {
      await this.attemptRegistration()
    }

    // Also call subclass alarm handler if defined
    await this.handleAlarm?.()
  }

  /**
   * Override this to handle fetch requests
   */
  protected abstract handleFetch(request: Request): Promise<Response>

  /**
   * Override this to handle alarms (optional)
   */
  protected handleAlarm?(): Promise<void>

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Get registration status
   */
  async getRegistrationStatus(): Promise<{
    registered: boolean
    attempts: number
    lastError?: string
    registeredAt?: number
    name?: string
    colo?: string
  }> {
    const state = await this.getRegistrationState()
    return {
      ...state,
      name: this._name ?? undefined,
      colo: this._colo ?? undefined,
    }
  }

  /**
   * Force re-registration (for testing/recovery)
   */
  async forceReregister(): Promise<boolean> {
    await this.ctx.storage.delete(REGISTRATION_KEY)
    return this.attemptRegistration()
  }
}

// ============================================================================
// Mixin for existing DOs
// ============================================================================

/**
 * Add self-registration to an existing DO class
 *
 * @example
 * ```typescript
 * import { withSelfRegistration } from 'colo.do'
 *
 * class MyDO implements DurableObject {
 *   // ...existing implementation
 * }
 *
 * export const RegisteredMyDO = withSelfRegistration(MyDO, {
 *   namespace: 'MY_DO',
 *   registryBinding: 'REGISTRY_DO',
 * })
 * ```
 */
export function withSelfRegistration<T extends new (...args: any[]) => DurableObject>(
  BaseClass: T,
  config: RegistrationConfig
) {
  return class SelfRegistering extends BaseClass {
    /** @internal */ _sr_registrationState: RegistrationState | null = null
    /** @internal */ _sr_colo: string | null = null
    /** @internal */ _sr_idInfo: { id: string; name: string; colo: string } | null = null

    async fetch(request: Request): Promise<Response> {
      // Detect colo
      const cf = (request as unknown as { cf?: IncomingRequestCfProperties }).cf
      this._sr_colo = cf?.colo ?? null

      // Attempt registration
      const ctx = (this as any).ctx as DurableObjectState
      const env = (this as any).env as Record<string, unknown>

      if (!this._sr_registrationState) {
        this._sr_registrationState = await ctx.storage.get<RegistrationState>(REGISTRATION_KEY) ?? { registered: false, attempts: 0 }
      }

      if (!this._sr_registrationState.registered && this._sr_colo) {
        ctx.waitUntil(this._sr_attemptRegistration(ctx, env))
      }

      // Call original fetch
      return super.fetch!(request)
    }

    async alarm(): Promise<void> {
      const ctx = (this as any).ctx as DurableObjectState
      const env = (this as any).env as Record<string, unknown>

      // Retry registration
      if (!this._sr_registrationState?.registered) {
        await this._sr_attemptRegistration(ctx, env)
      }

      // Call original alarm if exists
      if (super.alarm) {
        await super.alarm()
      }
    }

    /** @internal */
    async _sr_attemptRegistration(ctx: DurableObjectState, env: Record<string, unknown>): Promise<boolean> {
      if (!this._sr_colo) return false

      const registryDO = env[config.registryBinding] as DurableObjectNamespace | undefined
      if (!registryDO) return false

      try {
        // Get or create ID info
        if (!this._sr_idInfo) {
          this._sr_idInfo = await ctx.storage.get<{ id: string; name: string; colo: string }>('__colo_id_info') ?? null
        }

        if (!this._sr_idInfo) {
          const random = crypto.randomUUID().slice(0, 8)
          const name = `${config.namespace.toLowerCase()}-${random}`
          const id = `${this._sr_colo}:${name}:${Date.now().toString(36)}:${random}`
          this._sr_idInfo = { id, name, colo: this._sr_colo }
          await ctx.storage.put('__colo_id_info', this._sr_idInfo)
        }

        // Register
        const stub = registryDO.get(registryDO.idFromName('global'))
        const response = await stub.fetch('http://registry/_rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'registerSelf',
            args: [{
              namespace: config.namespace,
              name: this._sr_idInfo.name,
              id: this._sr_idInfo.id,
              colo: this._sr_idInfo.colo,
              createdAt: Date.now(),
            }],
          }),
        })

        if (!response.ok) throw new Error(`Registry returned ${response.status}`)

        this._sr_registrationState = { registered: true, attempts: (this._sr_registrationState?.attempts ?? 0) + 1, registeredAt: Date.now() }
        await ctx.storage.put(REGISTRATION_KEY, this._sr_registrationState)
        return true

      } catch (error) {
        const attempts = (this._sr_registrationState?.attempts ?? 0) + 1
        this._sr_registrationState = {
          registered: false,
          attempts,
          lastError: error instanceof Error ? error.message : String(error),
        }
        await ctx.storage.put(REGISTRATION_KEY, this._sr_registrationState)

        // Schedule retry
        const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES
        if (maxRetries === 0 || attempts < maxRetries) {
          const delay = (config.retryDelayMs ?? DEFAULT_RETRY_DELAY) * Math.pow(2, attempts - 1)
          await ctx.storage.setAlarm(Date.now() + Math.min(delay, 60000) + Math.random() * 1000)
        }

        return false
      }
    }
  }
}
