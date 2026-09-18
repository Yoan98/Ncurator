import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/case/showcase/**/*.showcase.test.ts'],
    exclude: ['tests/harness/**', 'tests/fixtures/**', 'tests/logs/**'],
    environment: 'node',
    globals: true,
    fileParallelism: true,
    testTimeout: 1_800_000,
    hookTimeout: 1_800_000,
    passWithNoTests: false,
    execArgv: ['--experimental-sqlite']
  }
})
