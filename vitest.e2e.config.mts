import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/case/**/*.e2e.test.ts', 'tests/case/**/*.e2e.test.tsx'],
    exclude: ['tests/harness/**', 'tests/fixtures/**', 'tests/logs/**'],
    environment: 'node',
    globals: true,
    fileParallelism: true,
    testTimeout: 900_000,
    hookTimeout: 900_000,
    passWithNoTests: false
  }
})
