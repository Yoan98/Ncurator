import { defineConfig } from 'vitest/config'
import e2eConfig from './vitest.e2e.config.mts'

export default defineConfig({
  ...e2eConfig,
  test: {
    ...e2eConfig.test,
    include: ['tests/case/workbench/conversation/provider-matrix/**/*.e2e.test.ts'],
    exclude: []
  }
})
