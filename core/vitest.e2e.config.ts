import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'e2e',
    watch: false,
    testTimeout: 30000,
    include: ['src/__tests__/**/*.e2e.test.ts'],
    env: {
      E2E: 'true',
      COLO_DO_URL: process.env.COLO_DO_URL || 'https://colo.do',
    },
  },
})
