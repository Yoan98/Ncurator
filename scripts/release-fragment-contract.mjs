/* eslint-disable @typescript-eslint/explicit-function-return-type */
const PLATFORM_AUDIT = Object.freeze({
  'windows-x64': { platform: 'win32', arch: 'x64', requiresSignature: false },
  'macos-arm64': { platform: 'darwin', arch: 'arm64', requiresSignature: true },
  'macos-x64': { platform: 'darwin', arch: 'x64', requiresSignature: true }
})

const SHA512_BASE64 = /^[A-Za-z0-9+/]{86}==$/u
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/u
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0
const isPositiveInteger = (value) => Number.isSafeInteger(value) && value > 0
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)
const isValidDate = (value) => isNonEmptyString(value) && !Number.isNaN(Date.parse(value))

const fail = (label, reason) => {
  throw new Error(`${label} is invalid: ${reason}`)
}

export const assertPackageAudit = (audit, platform, label = 'package audit') => {
  const expected = PLATFORM_AUDIT[platform]
  if (!expected) fail(label, `unsupported platform ${String(platform)}`)
  if (!audit || typeof audit !== 'object') fail(label, 'audit report is missing')
  if (audit.schemaVersion !== 1) fail(label, 'schemaVersion must be 1')
  if (audit.platform !== expected.platform || audit.arch !== expected.arch) {
    fail(label, `expected ${expected.platform}-${expected.arch}`)
  }
  if (!isValidDate(audit.generatedAt)) fail(label, 'generatedAt must be a valid timestamp')
  if (!Array.isArray(audit.applications) || audit.applications.length === 0) {
    fail(label, 'applications must not be empty')
  }
  for (const application of audit.applications) {
    if (!isNonEmptyString(application?.root)) fail(label, 'application root is missing')
    if (!isPositiveInteger(application.totalBytes)) fail(label, 'invalid installed size')
    if (!isPositiveInteger(application.archiveBytes)) fail(label, 'invalid app.asar size')
    if (!isPositiveInteger(application.archiveFileCount)) fail(label, 'invalid app.asar file count')
  }
  if (audit.sizeBudget) {
    if (!['passed', 'warning', 'not-configured'].includes(audit.sizeBudget.status)) {
      fail(label, 'package size budget did not pass')
    }
    const expectedBudgetPlatform = `${expected.platform}-${expected.arch}`
    if (audit.sizeBudget.platform !== expectedBudgetPlatform) {
      fail(label, `expected size budget platform ${expectedBudgetPlatform}`)
    }
    if (!Array.isArray(audit.sizeBudget.metrics)) fail(label, 'size budget metrics are missing')
    const metricNames = new Set()
    for (const metric of audit.sizeBudget.metrics) {
      if (!isNonEmptyString(metric?.name)) fail(label, 'size budget metric name is missing')
      if (metricNames.has(metric.name)) fail(label, `duplicate size budget metric ${metric.name}`)
      metricNames.add(metric.name)
      if (!['passed', 'warning'].includes(metric.status)) fail(label, 'size budget metric failed')
      if (!isPositiveInteger(metric.actualBytes)) fail(label, 'invalid actual package size')
      if (!isPositiveInteger(metric.baselineBytes)) fail(label, 'invalid baseline package size')
      if (!isPositiveInteger(metric.hardLimitBytes)) fail(label, 'invalid package size hard limit')
      if (!isFiniteNumber(metric.growthPercent)) fail(label, 'invalid package size growth')
    }
    if (expected.platform === 'darwin') {
      for (const requiredName of ['installedApp', 'appAsar', 'dmg', 'zip']) {
        if (!metricNames.has(requiredName))
          fail(label, `missing size budget metric ${requiredName}`)
      }
    }
  }
  return audit
}

export const assertReleaseFragment = (
  fragment,
  { tag: expectedTag, platform: expectedPlatform, label = 'release fragment' } = {}
) => {
  if (!fragment || typeof fragment !== 'object') fail(label, 'document is missing')
  if (fragment.schemaVersion !== 2) fail(label, 'schemaVersion must be 2')
  if (!RELEASE_TAG.test(fragment.tag)) fail(label, 'tag must use vX.Y.Z')
  if (expectedTag && fragment.tag !== expectedTag) fail(label, `expected tag ${expectedTag}`)
  if (fragment.version !== fragment.tag.slice(1)) fail(label, 'version does not match tag')
  if (!PLATFORM_AUDIT[fragment.platform]) fail(label, 'unsupported platform')
  if (expectedPlatform && fragment.platform !== expectedPlatform) {
    fail(label, `expected platform ${expectedPlatform}`)
  }
  if (!isValidDate(fragment.createdAt)) fail(label, 'createdAt must be a valid timestamp')

  if (!Array.isArray(fragment.files) || fragment.files.length === 0) {
    fail(label, 'files must not be empty')
  }
  const names = new Set()
  for (const file of fragment.files) {
    if (!isNonEmptyString(file?.name) || !ASSET_NAME.test(file.name)) {
      fail(label, 'asset name must be a plain filename')
    }
    if (names.has(file.name)) fail(label, `duplicate asset ${file.name}`)
    names.add(file.name)
    if (!['installer', 'update'].includes(file.role)) fail(label, `invalid role for ${file.name}`)
    if (!isPositiveInteger(file.size)) fail(label, `invalid size for ${file.name}`)
    if (!SHA512_BASE64.test(file.sha512)) fail(label, `invalid sha512 for ${file.name}`)
  }
  if (fragment.files.filter((file) => file.role === 'installer').length !== 1) {
    fail(label, 'exactly one installer is required')
  }

  if (!isNonEmptyString(fragment.metadata)) fail(label, 'update metadata is missing')
  const escapedVersion = fragment.version.replaceAll('.', '\\.')
  if (!new RegExp(`^version:\\s*${escapedVersion}\\s*$`, 'mu').test(fragment.metadata)) {
    fail(label, 'update metadata version does not match tag')
  }

  assertPackageAudit(fragment.audit, fragment.platform, `${label} audit`)
  const requiresSignature = PLATFORM_AUDIT[fragment.platform].requiresSignature
  if (requiresSignature && !isNonEmptyString(fragment.signature)) {
    fail(label, 'macOS signature is missing')
  }
  return fragment
}

export const RELEASE_PLATFORMS = Object.freeze(Object.keys(PLATFORM_AUDIT))
