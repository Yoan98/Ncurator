import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import JavaScriptObfuscator from 'javascript-obfuscator'

const require = createRequire(import.meta.url)
const obfuscatorPackage = require('javascript-obfuscator/package.json')

export const MAIN_OBFUSCATION_SCHEMA_VERSION = 1
export const MAIN_OBFUSCATION_CONFIGURATION_VERSION = 2
export const MAX_MAIN_OBFUSCATION_GROWTH_BYTES = 3 * 1024 * 1024

export const PROTECTED_MAIN_PLAINTEXT_MARKERS = [
  {
    id: 'brain-system-prompt',
    value: '根据已有信息自主决策下一步工具的使用来推进任务'
  },
  {
    id: 'delivery-contract',
    value: '停止调用工具，直接输出最终交付的 markdown 正文'
  }
]

const JAVASCRIPT_EXTENSIONS = new Set(['.js', '.cjs', '.mjs'])

const normalizeRelativePath = (value) => value.replaceAll(path.sep, '/')

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

const deriveSeed = (relativePath) => {
  const digest = crypto
    .createHash('sha256')
    .update(`ncurator-main-obfuscation-v1\0${normalizeRelativePath(relativePath)}`)
    .digest()
  return Math.max(1, digest.readUInt32BE(0) & 0x7fffffff)
}

export const createMainObfuscationOptions = (relativePath) => ({
  compact: true,
  target: 'node',
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  renameProperties: false,
  transformObjectKeys: false,
  stringArray: true,
  stringArrayThreshold: 1,
  stringArrayEncoding: ['rc4'],
  stringArrayRotate: true,
  stringArrayShuffle: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  selfDefending: false,
  disableConsoleOutput: false,
  numbersToExpressions: false,
  unicodeEscapeSequence: false,
  sourceMap: false,
  seed: deriveSeed(relativePath)
})

export const obfuscateMainJavaScript = (source, relativePath) =>
  JavaScriptObfuscator.obfuscate(
    source,
    createMainObfuscationOptions(relativePath)
  ).getObfuscatedCode()

const listJavaScriptFiles = (rootDirectory) => {
  const result = []
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(absolutePath)
        continue
      }
      if (entry.isFile() && JAVASCRIPT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        result.push(absolutePath)
      }
    }
  }
  walk(rootDirectory)
  return result.sort((left, right) => left.localeCompare(right))
}

const assertJavaScriptSyntax = (filePath) => {
  const result = spawnSync(process.execPath, ['--check', filePath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `obfuscated JavaScript syntax check failed for ${filePath}:\n${String(result.stderr || result.stdout).trim()}`
    )
  }
}

const assertProtectedMarkersPresent = (sources) => {
  const missing = PROTECTED_MAIN_PLAINTEXT_MARKERS.filter(
    (marker) => !sources.some((source) => source.includes(marker.value))
  )
  if (missing.length > 0) {
    throw new Error(
      `main obfuscation protection markers were not found before obfuscation: ${missing
        .map((marker) => marker.id)
        .join(', ')}`
    )
  }
}

export const assertProtectedMainPlaintextAbsent = (source, sourceLabel) => {
  const exposed = PROTECTED_MAIN_PLAINTEXT_MARKERS.filter((marker) => source.includes(marker.value))
  if (exposed.length > 0) {
    throw new Error(
      `${sourceLabel} exposes protected main-process plaintext: ${exposed
        .map((marker) => marker.id)
        .join(', ')}`
    )
  }
}

const writeJsonAtomically = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.tmp-${String(process.pid)}`
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    fs.renameSync(temporaryPath, filePath)
  } finally {
    fs.rmSync(temporaryPath, { force: true })
  }
}

export const obfuscatePackageMain = ({ stageDirectory, reportPath }) => {
  const stageRoot = path.resolve(stageDirectory)
  const mainDirectory = path.join(stageRoot, 'out', 'main')
  const resolvedReportPath = path.resolve(reportPath)
  fs.rmSync(resolvedReportPath, { force: true })

  if (!fs.existsSync(mainDirectory) || !fs.statSync(mainDirectory).isDirectory()) {
    throw new Error(`staged main-process directory not found: ${mainDirectory}`)
  }

  const packageJsonPath = path.join(stageRoot, 'package.json')
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  const files = listJavaScriptFiles(mainDirectory)
  if (files.length === 0)
    throw new Error(`no staged main-process JavaScript found: ${mainDirectory}`)

  const originalSources = files.map((filePath) => fs.readFileSync(filePath, 'utf8'))
  assertProtectedMarkersPresent(originalSources)

  const pending = []
  let originalBytes = 0
  let obfuscatedBytes = 0
  let growthBytes = 0
  try {
    for (let index = 0; index < files.length; index += 1) {
      const filePath = files[index]
      const relativePath = normalizeRelativePath(path.relative(stageRoot, filePath))
      const originalSource = originalSources[index]
      const obfuscatedSource = obfuscateMainJavaScript(originalSource, relativePath)
      if (!obfuscatedSource || obfuscatedSource === originalSource) {
        throw new Error(`main-process JavaScript was not transformed: ${relativePath}`)
      }
      assertProtectedMainPlaintextAbsent(obfuscatedSource, relativePath)
      if (
        /(?:\/\/[#@]\s*sourceMappingURL\s*=|\/\*[#@]\s*sourceMappingURL\s*=)/u.test(
          obfuscatedSource
        )
      ) {
        throw new Error(
          `obfuscated main-process JavaScript references a source map: ${relativePath}`
        )
      }

      const extension = path.extname(filePath)
      const temporaryPath = path.join(
        path.dirname(filePath),
        `.${path.basename(filePath, extension)}.obfuscating-${String(process.pid)}${extension}`
      )
      fs.writeFileSync(temporaryPath, obfuscatedSource, 'utf8')
      pending.push({
        filePath,
        temporaryPath,
        relativePath,
        originalBytes: Buffer.byteLength(originalSource),
        obfuscatedBytes: Buffer.byteLength(obfuscatedSource),
        originalSha256: sha256(originalSource),
        obfuscatedSha256: sha256(obfuscatedSource)
      })
      assertJavaScriptSyntax(temporaryPath)
    }

    originalBytes = pending.reduce((sum, item) => sum + item.originalBytes, 0)
    obfuscatedBytes = pending.reduce((sum, item) => sum + item.obfuscatedBytes, 0)
    growthBytes = obfuscatedBytes - originalBytes
    if (growthBytes > MAX_MAIN_OBFUSCATION_GROWTH_BYTES) {
      throw new Error(
        `main-process obfuscation grew by ${(growthBytes / 1024 / 1024).toFixed(1)} MiB; limit is ${(MAX_MAIN_OBFUSCATION_GROWTH_BYTES / 1024 / 1024).toFixed(1)} MiB`
      )
    }

    for (const item of pending) fs.renameSync(item.temporaryPath, item.filePath)
  } finally {
    for (const item of pending) fs.rmSync(item.temporaryPath, { force: true })
  }

  const report = {
    schemaVersion: MAIN_OBFUSCATION_SCHEMA_VERSION,
    configurationVersion: MAIN_OBFUSCATION_CONFIGURATION_VERSION,
    status: 'passed',
    generatedAt: new Date().toISOString(),
    packageVersion: String(packageJson.version || ''),
    tool: {
      name: 'javascript-obfuscator',
      version: String(obfuscatorPackage.version)
    },
    protectedMarkers: PROTECTED_MAIN_PLAINTEXT_MARKERS.map((marker) => marker.id),
    totals: {
      files: pending.length,
      originalBytes,
      obfuscatedBytes,
      growthBytes,
      growthPercent: originalBytes > 0 ? (growthBytes / originalBytes) * 100 : 0
    },
    files: pending.map((item) => ({
      path: item.relativePath,
      originalBytes: item.originalBytes,
      obfuscatedBytes: item.obfuscatedBytes,
      originalSha256: item.originalSha256,
      obfuscatedSha256: item.obfuscatedSha256
    }))
  }
  writeJsonAtomically(resolvedReportPath, report)
  return report
}

export const verifyPackageMainObfuscation = ({ stageDirectory, reportPath }) => {
  const stageRoot = path.resolve(stageDirectory)
  const mainDirectory = path.join(stageRoot, 'out', 'main')
  const resolvedReportPath = path.resolve(reportPath)
  if (!fs.existsSync(resolvedReportPath)) {
    throw new Error(`main-process obfuscation report not found: ${resolvedReportPath}`)
  }

  const report = JSON.parse(fs.readFileSync(resolvedReportPath, 'utf8'))
  if (
    report.schemaVersion !== MAIN_OBFUSCATION_SCHEMA_VERSION ||
    report.configurationVersion !== MAIN_OBFUSCATION_CONFIGURATION_VERSION ||
    report.status !== 'passed'
  ) {
    throw new Error('main-process obfuscation report has an unsupported or failed status')
  }
  if (
    report.tool?.name !== 'javascript-obfuscator' ||
    report.tool?.version !== String(obfuscatorPackage.version) ||
    JSON.stringify(report.protectedMarkers) !==
      JSON.stringify(PROTECTED_MAIN_PLAINTEXT_MARKERS.map((marker) => marker.id))
  ) {
    throw new Error('main-process obfuscation report does not match the active protection policy')
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(stageRoot, 'package.json'), 'utf8'))
  if (report.packageVersion !== String(packageJson.version || '')) {
    throw new Error('main-process obfuscation report does not match the staged package version')
  }

  const currentFiles = listJavaScriptFiles(mainDirectory).map((filePath) =>
    normalizeRelativePath(path.relative(stageRoot, filePath))
  )
  const reportedFiles = report.files.map((item) => item.path)
  if (JSON.stringify(currentFiles) !== JSON.stringify(reportedFiles)) {
    throw new Error('main-process obfuscation report does not match the staged JavaScript files')
  }

  for (const item of report.files) {
    const filePath = path.join(stageRoot, item.path)
    const source = fs.readFileSync(filePath, 'utf8')
    if (sha256(source) !== item.obfuscatedSha256 || item.originalSha256 === item.obfuscatedSha256) {
      throw new Error(`main-process obfuscation hash mismatch: ${item.path}`)
    }
    assertProtectedMainPlaintextAbsent(source, item.path)
    assertJavaScriptSyntax(filePath)
  }

  const originalBytes = report.files.reduce((sum, item) => sum + Number(item.originalBytes || 0), 0)
  const obfuscatedBytes = report.files.reduce(
    (sum, item) => sum + Number(item.obfuscatedBytes || 0),
    0
  )
  if (
    report.totals.files !== report.files.length ||
    report.totals.originalBytes !== originalBytes ||
    report.totals.obfuscatedBytes !== obfuscatedBytes ||
    report.totals.growthBytes !== obfuscatedBytes - originalBytes
  ) {
    throw new Error('main-process obfuscation report totals are inconsistent')
  }
  if (report.totals.growthBytes > MAX_MAIN_OBFUSCATION_GROWTH_BYTES) {
    throw new Error('main-process obfuscation report exceeds the allowed growth budget')
  }

  return report
}
