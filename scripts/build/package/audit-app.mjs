import { parse as parseYaml } from 'yaml'
import { hashSharedEntries, distributionName } from '../../release/shared/distribution.mjs'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { listPackage, extractFile, getRawHeader } from '@electron/asar'
import {
  assertMinimalPackageJson,
  assertSafePackagePaths,
  assertWebCrawlerSidecarPackage,
  auditPackageDirectory,
  normalizeRelativePath,
  scanTextForSecrets
} from './content-policy.mjs'
import { assertProtectedMainPlaintextAbsent } from './obfuscation.mjs'
import { assertVcRuntimeDllsPackaged } from './vc-runtime.mjs'
import { evaluatePackageSizeBudget, loadPackageSizeBudgetConfig } from './size-budget.mjs'

const inputDirectory = path.resolve(process.argv[2] || 'dist')
const reportPath = path.join(inputDirectory, 'package-audit.json')
const sizeBudgetPath = path.resolve('build/package-size-budgets.json')
const runtimeTraceReportPath = process.argv[3] ? path.resolve(process.argv[3]) : ''
const runtimeTraceReport = runtimeTraceReportPath
  ? JSON.parse(fs.readFileSync(runtimeTraceReportPath, 'utf8'))
  : null

const assertRuntimeTracePackaged = (archiveEntries, archivePath) => {
  if (!runtimeTraceReport) return
  const entries = new Set(archiveEntries)
  for (const dependency of runtimeTraceReport.packages || []) {
    const manifestPath = `node_modules/${dependency.name}/package.json`
    if (!entries.has(manifestPath)) {
      throw new Error(`${archivePath} is missing traced runtime package ${dependency.name}`)
    }
  }
  for (const required of runtimeTraceReport.requiredFiles || []) {
    const requiredPath = `node_modules/${required.package}/${required.path}`
    if (!entries.has(requiredPath)) {
      throw new Error(`${archivePath} is missing required runtime file ${required.id}`)
    }
  }
}

const findFiles = (directory, predicate) => {
  const result = []
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) walk(entryPath)
      else if (entry.isFile() && predicate(entryPath)) result.push(entryPath)
    }
  }
  walk(directory)
  return result
}

const findApplicationRoot = (archivePath) => {
  let current = path.dirname(archivePath)
  while (current !== path.dirname(current)) {
    if (current.endsWith('.app')) return current
    current = path.dirname(current)
  }
  return path.dirname(path.dirname(archivePath))
}

const listArchiveFiles = (archivePath) => {
  const files = []
  const walk = (node, parent = '') => {
    for (const [name, entry] of Object.entries(node.files || {})) {
      const relativePath = parent ? `${parent}/${name}` : name
      if (entry.files) walk(entry, relativePath)
      else
        files.push({
          relativePath,
          size: Number(entry.size || 0),
          unpacked: Boolean(entry.unpacked)
        })
    }
  }
  walk(getRawHeader(archivePath).header)
  return files
}

const formatBytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`
const extractArchiveFile = (archivePath, relativePath) =>
  extractFile(archivePath, relativePath.replaceAll('/', path.sep))

const assertPackagedNodePtyHelpersExecutable = (appRoot) => {
  if (process.platform === 'win32') return
  const helpers = findFiles(
    appRoot,
    (filePath) =>
      path.basename(filePath) === 'spawn-helper' &&
      filePath.includes(`${path.sep}node-pty${path.sep}`)
  )
  if (helpers.length === 0) {
    throw new Error(`packaged node-pty spawn-helper not found: ${appRoot}`)
  }
  for (const helperPath of helpers) {
    try {
      fs.accessSync(helperPath, fs.constants.X_OK)
    } catch {
      throw new Error(`packaged node-pty spawn-helper is not executable: ${helperPath}`)
    }
  }
}

if (!fs.existsSync(inputDirectory)) throw new Error(`package output not found: ${inputDirectory}`)

const archives = findFiles(inputDirectory, (filePath) => path.basename(filePath) === 'app.asar')
if (archives.length === 0) throw new Error(`no packaged app.asar found under ${inputDirectory}`)

const applications = []
for (const archivePath of archives) {
  const archiveEntries = listPackage(archivePath).map(normalizeRelativePath)
  assertSafePackagePaths(archiveEntries)
  assertRuntimeTracePackaged(archiveEntries, archivePath)
  const archiveRoots = [...new Set(archiveEntries.map((entry) => entry.split('/')[0]))].sort()
  const unexpectedRoots = archiveRoots.filter(
    (name) => !['node_modules', 'out', 'package.json'].includes(name)
  )
  if (unexpectedRoots.length > 0) {
    throw new Error(`unexpected app.asar root entries: ${unexpectedRoots.join(', ')}`)
  }

  const packagedPackageJson = JSON.parse(
    extractArchiveFile(archivePath, 'package.json').toString('utf8')
  )
  assertMinimalPackageJson(packagedPackageJson, `${archivePath}:package.json`)

  const archiveFiles = listArchiveFiles(archivePath)
  const sharedAppHash = hashSharedEntries(
    archiveFiles
      .filter((item) => item.relativePath.startsWith('out/'))
      .map((item) => [item.relativePath, extractArchiveFile(archivePath, item.relativePath)])
  )
  const hashPath = path.join(inputDirectory, 'shared-app.sha256')
  if (fs.existsSync(hashPath) && fs.readFileSync(hashPath, 'utf8').trim() !== sharedAppHash) {
    throw new Error('Packaged shared application resources do not match the build')
  }
  for (const item of archiveFiles) {
    if (!item.relativePath.startsWith('out/') || item.size > 25 * 1024 * 1024) continue
    if (!/\.(?:js|cjs|mjs|json|html|css)$/u.test(item.relativePath)) continue
    const source = extractArchiveFile(archivePath, item.relativePath).toString('utf8')
    scanTextForSecrets(source, `${archivePath}:${item.relativePath}`)
    if (item.relativePath.startsWith('out/main/')) {
      assertProtectedMainPlaintextAbsent(source, `${archivePath}:${item.relativePath}`)
    }
  }

  const appRoot = findApplicationRoot(archivePath)
  const expectedMarkerPath = path.join(inputDirectory, 'app-distribution.json')
  if (fs.existsSync(expectedMarkerPath)) {
    const distribution = JSON.parse(fs.readFileSync(expectedMarkerPath, 'utf8')).distribution
    const resourcesDirectory = path.dirname(archivePath)
    const marker = JSON.parse(
      fs.readFileSync(path.join(resourcesDirectory, 'app-distribution.json'), 'utf8')
    )
    const update = parseYaml(
      fs.readFileSync(path.join(resourcesDirectory, 'app-update.yml'), 'utf8')
    )
    const origin =
      distribution === 'international'
        ? 'https://download.ncurator.com'
        : 'https://download.guanzhangai.cn'
    if (
      marker.distribution !== distribution ||
      update.url !== `${origin}/updates/latest` ||
      update.updaterCacheDirName !== 'ncurator-updater'
    )
      throw new Error('Packaged distribution or fixed update configuration is incorrect')
    const name = distributionName(distribution)
    if (process.platform === 'darwin' && path.basename(appRoot) !== `${name}.app`)
      throw new Error('Packaged application name is incorrect')
    if (process.platform === 'win32' && !fs.existsSync(path.join(appRoot, `${name}.exe`)))
      throw new Error('Packaged executable name is incorrect')
  }
  assertPackagedNodePtyHelpersExecutable(appRoot)
  assertVcRuntimeDllsPackaged(appRoot)
  const directoryAudit = auditPackageDirectory(appRoot)
  const totalBytes = directoryAudit.files.reduce((sum, item) => sum + item.size, 0)
  const webCrawlerSidecarBytes = assertWebCrawlerSidecarPackage(directoryAudit.files, appRoot)
  const topFiles = [...directoryAudit.files]
    .sort((left, right) => right.size - left.size)
    .slice(0, 30)
    .map((item) => ({ path: item.relativePath, bytes: item.size }))
  applications.push({
    root: path.relative(inputDirectory, appRoot) || '.',
    sharedAppHash,
    archive: path.relative(inputDirectory, archivePath),
    totalBytes,
    webCrawlerSidecarBytes,
    archiveBytes: fs.statSync(archivePath).size,
    archiveFileCount: archiveFiles.length,
    unpackedPayloadBytes: archiveFiles
      .filter((item) => item.unpacked)
      .reduce((sum, item) => sum + item.size, 0),
    topFiles
  })
  process.stdout.write(
    `[package] audit passed: ${path.basename(appRoot)} ${formatBytes(totalBytes)}, ` +
      `web crawler sidecar ${formatBytes(webCrawlerSidecarBytes)}, ` +
      `app.asar ${formatBytes(fs.statSync(archivePath).size)}\n`
  )
}

const installerExtensions = new Set(['.dmg', '.zip', '.exe', '.appimage', '.deb', '.snap'])
const installers = fs
  .readdirSync(inputDirectory, { withFileTypes: true })
  .filter(
    (entry) => entry.isFile() && installerExtensions.has(path.extname(entry.name).toLowerCase())
  )
  .map((entry) => ({
    name: entry.name,
    bytes: fs.statSync(path.join(inputDirectory, entry.name)).size
  }))
  .sort((left, right) => right.bytes - left.bytes)

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  applications,
  distribution: fs.existsSync(path.join(inputDirectory, 'app-distribution.json'))
    ? JSON.parse(fs.readFileSync(path.join(inputDirectory, 'app-distribution.json'), 'utf8'))
        .distribution
    : 'domestic',
  sharedAppHash: applications[0]?.sharedAppHash,
  installers,
  runtimeTrace: runtimeTraceReport
    ? {
        schemaVersion: runtimeTraceReport.schemaVersion,
        packages: runtimeTraceReport.packages.length,
        requiredFiles: runtimeTraceReport.requiredFiles.length,
        report: path.relative(inputDirectory, runtimeTraceReportPath)
      }
    : null
}
report.sizeBudget = evaluatePackageSizeBudget(report, loadPackageSizeBudgetConfig(sizeBudgetPath))
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
process.stdout.write(`[package] audit report: ${reportPath}\n`)
for (const metric of report.sizeBudget.metrics) {
  if (metric.status === 'passed') continue
  process.stdout.write(
    `[package] size budget ${metric.status}: ${metric.label} ${formatBytes(metric.actualBytes)}, ` +
      `baseline ${formatBytes(metric.baselineBytes)}, growth ${metric.growthPercent.toFixed(1)}%, ` +
      `hard limit ${formatBytes(metric.hardLimitBytes)}\n`
  )
}
if (report.sizeBudget.status === 'failed') {
  throw new Error(`package size budget failed for ${report.sizeBudget.platform}`)
}
