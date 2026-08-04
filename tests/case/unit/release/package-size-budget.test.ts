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

  it('loads the approved macOS arm64 and x64 baselines', () => {
    const config = loadPackageSizeBudgetConfig(path.resolve('build/package-size-budgets.json'))

    expect(config.platforms['darwin-arm64']).toMatchObject({
      installedApp: { baselineMiB: 1113.3, hardLimitMiB: 1200 },
      appAsar: { baselineMiB: 230.9, hardLimitMiB: 252 },
      dmg: { baselineMiB: 432.9, hardLimitMiB: 480 },
      zip: { baselineMiB: 418.5, hardLimitMiB: 465 }
    })
    expect(config.platforms['darwin-x64']).toMatchObject({
      installedApp: { baselineMiB: 1145.6, hardLimitMiB: 1230 },
      appAsar: { baselineMiB: 230.9, hardLimitMiB: 252 },
      dmg: { baselineMiB: 447.9, hardLimitMiB: 495 },
      zip: { baselineMiB: 433.3, hardLimitMiB: 480 }
    })
  })
})
