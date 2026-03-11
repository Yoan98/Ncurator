import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/renderer/**/*.test.ts', 'tests/renderer/**/*.test.tsx'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['tests/harness/renderer/setup.ts'],
    pool: 'threads',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    passWithNoTests: false
  }
})
