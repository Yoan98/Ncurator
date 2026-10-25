import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/case/**/*.e2e.test.ts', 'tests/case/**/*.e2e.test.tsx'],
    exclude: [
      'tests/harness/**',
      'tests/fixtures/**',
      'tests/logs/**',
      'tests/case/workbench/conversation/provider-matrix/**'
    ],
    environment: 'node',
    globals: true,
    fileParallelism: true,
    testTimeout: 900_000,
    hookTimeout: 900_000,
    passWithNoTests: false,
    // Node 22 keeps node:sqlite behind this flag; database-version e2e imports DatabaseSync.
    execArgv: ['--experimental-sqlite']
  }
})
