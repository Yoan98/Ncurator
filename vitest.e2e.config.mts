import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts', 'tests/e2e/**/*.test.tsx'],
    environment: 'node',
    globals: true,
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    passWithNoTests: false
  }
})
