/// <reference types="@cloudflare/vitest-pool-workers" />

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    COLO_DO: DurableObjectNamespace
    DO_REGISTRY: DurableObjectNamespace
  }
}
