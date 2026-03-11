import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/main/**/*.test.ts'],
    environment: 'node',
    globals: true,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    passWithNoTests: false
  }
})
