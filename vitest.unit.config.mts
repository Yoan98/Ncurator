import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    environment: 'node',
    globals: true,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    passWithNoTests: false
  }
})
