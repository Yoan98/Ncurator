import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/case/**/*.test.ts'],
    exclude: [
      'tests/**/*.e2e.test.ts',
      'tests/**/*.showcase.test.ts',
      'tests/harness/**',
      'tests/fixtures/**',
      'tests/logs/**'
    ],
    environment: 'node',
    globals: true,
    fileParallelism: true,
    testTimeout: 900_000,
    hookTimeout: 900_000,
    passWithNoTests: false
  }
})
