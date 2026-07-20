import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { listPackage, extractFile, getRawHeader } from '@electron/asar'
import {
  assertMinimalPackageJson,
  assertSafePackagePaths,
  auditPackageDirectory,
  normalizeRelativePath,
  scanTextForSecrets
} from './package-content-policy.mjs'
import { assertProtectedMainPlaintextAbsent } from './package-main-obfuscation.mjs'
import { evaluatePackageSizeBudget, loadPackageSizeBudgetConfig } from './package-size-budget.mjs'

const inputDirectory = path.resolve(process.argv[2] || 'dist')
const reportPath = path.join(inputDirectory, 'package-audit.json')
const sizeBudgetPath = path.resolve('build/package-size-budgets.json')

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
  assertPackagedNodePtyHelpersExecutable(appRoot)
  const directoryAudit = auditPackageDirectory(appRoot)
  const totalBytes = directoryAudit.files.reduce((sum, item) => sum + item.size, 0)
  const topFiles = [...directoryAudit.files]
    .sort((left, right) => right.size - left.size)
    .slice(0, 30)
    .map((item) => ({ path: item.relativePath, bytes: item.size }))
  applications.push({
    root: path.relative(inputDirectory, appRoot) || '.',
    archive: path.relative(inputDirectory, archivePath),
    totalBytes,
    archiveBytes: fs.statSync(archivePath).size,
    archiveFileCount: archiveFiles.length,
    unpackedPayloadBytes: archiveFiles
      .filter((item) => item.unpacked)
      .reduce((sum, item) => sum + item.size, 0),
    topFiles
  })
  process.stdout.write(
    `[package] audit passed: ${path.basename(appRoot)} ${formatBytes(totalBytes)}, app.asar ${formatBytes(fs.statSync(archivePath).size)}\n`
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
  installers
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
