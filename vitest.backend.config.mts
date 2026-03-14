import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/backend/**/*.test.ts'],
    exclude: ['tests/harness/**', 'tests/fixtures/**', 'tests/logs/**', 'tests/report/**'],
    environment: 'node',
    globals: true,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    passWithNoTests: false
  }
})
