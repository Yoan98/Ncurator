import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.e2e.test.ts', 'tests/**/*.e2e.test.tsx'],
    exclude: ['tests/harness/**', 'tests/fixtures/**', 'tests/logs/**'],
    environment: 'node',
    globals: true,
    fileParallelism: false,
    testTimeout: 900_000,
    hookTimeout: 900_000,
    passWithNoTests: false
  }
})
