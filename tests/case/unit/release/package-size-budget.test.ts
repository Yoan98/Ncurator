import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  evaluatePackageSizeBudget,
  loadPackageSizeBudgetConfig
} from '../../../../scripts/build/package/size-budget.mjs'

const MIB = 1024 * 1024

const createReport = (totalMiB: number, platform = 'darwin', arch = 'arm64') => ({
  platform,
  arch,
  applications: [
    {
      totalBytes: Math.round(totalMiB * MIB),
      archiveBytes: 50 * MIB
    }
  ],
  installers: []
})

const createConfig = () => ({
  warningGrowthPercent: 3,
  failureGrowthPercent: 8,
  platforms: {
    'darwin-arm64': {
      installedApp: { baselineMiB: 100, hardLimitMiB: 120 }
    }
  }
})

describe('package size budget', () => {
  it.each([
    [102, 'passed'],
    [105, 'warning'],
    [109, 'failed'],
    [121, 'failed']
  ])('classifies an app of %s MiB as %s', (totalMiB, expectedStatus) => {
    const result = evaluatePackageSizeBudget(createReport(totalMiB), createConfig())
    expect(result.status).toBe(expectedStatus)
  })

  it('leaves platforms without a baseline unchanged', () => {
    const result = evaluatePackageSizeBudget(createReport(500, 'win32', 'x64'), createConfig())
    expect(result).toEqual({ status: 'not-configured', platform: 'win32-x64', metrics: [] })
  })

  it('loads only the approved macOS arm64 baseline', () => {
    const config = loadPackageSizeBudgetConfig(path.resolve('build/package-size-budgets.json'))

    expect(config.platforms['darwin-arm64']).toMatchObject({
      installedApp: { baselineMiB: 857.2, hardLimitMiB: 870 },
      appAsar: { baselineMiB: 199.2, hardLimitMiB: 205 },
      dmg: { baselineMiB: 303.7, hardLimitMiB: 310 },
      zip: { baselineMiB: 320.8, hardLimitMiB: 325 }
    })
    expect(config.platforms['darwin-x64']).toBeUndefined()
  })
})
