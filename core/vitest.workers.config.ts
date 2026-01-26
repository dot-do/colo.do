import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    name: 'workers',
    watch: false,
    testTimeout: 30000,
    hookTimeout: 15000,
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          compatibilityDate: '2024-12-01',
          compatibilityFlags: ['nodejs_compat'],
        },
        // Disable isolated storage - each test uses unique DO names
        isolatedStorage: false,
        singleWorker: true,
      },
    },
    include: ['src/__tests__/**/*.workers.test.ts'],
    exclude: ['src/__tests__/**/*.e2e.test.ts'],
    // Run tests sequentially to avoid storage conflicts
    fileParallelism: false,
  },
})
