import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src')
    }
  },
  test: {
    include: ['tests/renderer/**/*.test.ts', 'tests/renderer/**/*.test.tsx'],
    exclude: ['tests/harness/**', 'tests/fixtures/**', 'tests/logs/**', 'tests/report/**'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['tests/harness/renderer/setup.ts'],
    passWithNoTests: false
  }
})
