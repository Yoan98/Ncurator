import fs from 'node:fs'
import path from 'node:path'

const MIB = 1024 * 1024
const METRIC_LABELS = Object.freeze({
  installedApp: 'Installed app',
  appAsar: 'app.asar',
  dmg: 'DMG',
  zip: 'ZIP'
})

const toBytes = (mib) => Math.round(mib * MIB)
const toGrowthPercent = (actualBytes, baselineBytes) =>
  ((actualBytes - baselineBytes) / baselineBytes) * 100

const assertPositiveNumber = (value, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`invalid package size budget ${label}`)
  }
}

export const loadPackageSizeBudgetConfig = (configPath) => {
  const config = JSON.parse(fs.readFileSync(path.resolve(configPath), 'utf8'))
  if (config.schemaVersion !== 1) throw new Error('package size budget schemaVersion must be 1')
  assertPositiveNumber(config.warningGrowthPercent, 'warningGrowthPercent')
  assertPositiveNumber(config.failureGrowthPercent, 'failureGrowthPercent')
  if (config.warningGrowthPercent >= config.failureGrowthPercent) {
    throw new Error('package size warning threshold must be lower than failure threshold')
  }
  if (!config.platforms || typeof config.platforms !== 'object') {
    throw new Error('package size budget platforms are missing')
  }
  for (const [platform, metrics] of Object.entries(config.platforms)) {
    for (const [name, metric] of Object.entries(metrics)) {
      if (!METRIC_LABELS[name])
        throw new Error(`unsupported package size metric ${platform}.${name}`)
      assertPositiveNumber(metric?.baselineMiB, `${platform}.${name}.baselineMiB`)
      assertPositiveNumber(metric?.hardLimitMiB, `${platform}.${name}.hardLimitMiB`)
      if (metric.hardLimitMiB <= metric.baselineMiB) {
        throw new Error(`package size hard limit must exceed baseline for ${platform}.${name}`)
      }
    }
  }
  return config
}

const findInstallerBytes = (report, extension) =>
  report.installers?.find((installer) => installer.name.toLowerCase().endsWith(extension))?.bytes

const collectActualMetrics = (report) => {
  const application = report.applications?.[0]
  return {
    installedApp: application?.totalBytes,
    appAsar: application?.archiveBytes,
    dmg: findInstallerBytes(report, '.dmg'),
    zip: findInstallerBytes(report, '.zip')
  }
}

export const evaluatePackageSizeBudget = (report, config) => {
  const platform = `${report.platform}-${report.arch}`
  const platformBudget = config.platforms[platform]
  if (!platformBudget) {
    return { status: 'not-configured', platform, metrics: [] }
  }

  const actualMetrics = collectActualMetrics(report)
  const metrics = []
  for (const [name, budget] of Object.entries(platformBudget)) {
    const actualBytes = actualMetrics[name]
    if (!Number.isSafeInteger(actualBytes) || actualBytes <= 0) continue
    const baselineBytes = toBytes(budget.baselineMiB)
    const hardLimitBytes = toBytes(budget.hardLimitMiB)
    const growthPercent = toGrowthPercent(actualBytes, baselineBytes)
    const reasons = []
    let status = 'passed'
    if (actualBytes > hardLimitBytes) {
      status = 'failed'
      reasons.push('hard-limit')
    }
    if (growthPercent > config.failureGrowthPercent) {
      status = 'failed'
      reasons.push('growth-limit')
    } else if (growthPercent > config.warningGrowthPercent && status !== 'failed') {
      status = 'warning'
      reasons.push('growth-warning')
    }
    metrics.push({
      name,
      label: METRIC_LABELS[name],
      status,
      actualBytes,
      baselineBytes,
      hardLimitBytes,
      growthPercent,
      reasons
    })
  }

  const status = metrics.some((metric) => metric.status === 'failed')
    ? 'failed'
    : metrics.some((metric) => metric.status === 'warning')
      ? 'warning'
      : 'passed'
  return {
    status,
    platform,
    warningGrowthPercent: config.warningGrowthPercent,
    failureGrowthPercent: config.failureGrowthPercent,
    metrics
  }
}
