import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { nodeFileTrace } from '@vercel/nft'
import semver from 'semver'

const require = createRequire(import.meta.url)
const nftPackage = require('@vercel/nft/package.json')

const normalizePath = (value) => value.replaceAll(path.sep, '/')
const sha256File = (filePath) =>
  crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')

const assertString = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a string`)
}

export const loadRuntimeTracePolicy = (policyPath) => {
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'))
  if (policy.schemaVersion !== 1) throw new Error('runtime trace policy schemaVersion must be 1')
  if (!Array.isArray(policy.traceIgnore))
    throw new Error('runtime trace policy traceIgnore is missing')
  if (!Array.isArray(policy.explicitIncludes)) {
    throw new Error('runtime trace policy explicitIncludes is missing')
  }
  if (!Array.isArray(policy.warningRules) || policy.warningRules.length === 0) {
    throw new Error('runtime trace policy warningRules are missing')
  }
  if (!Array.isArray(policy.requiredFiles)) {
    throw new Error('runtime trace policy requiredFiles is missing')
  }

  const ids = new Set()
  for (const rule of policy.warningRules) {
    assertString(rule.id, 'warning rule id')
    assertString(rule.kind, `warning rule ${rule.id} kind`)
    if (!rule.package && !rule.packagePattern) {
      throw new Error(`warning rule ${rule.id} must define package or packagePattern`)
    }
    if (rule.package) assertString(rule.package, `warning rule ${rule.id} package`)
    if (rule.packagePattern) new RegExp(rule.packagePattern, 'u')
    assertString(rule.reason, `warning rule ${rule.id} reason`)
    if (!['parse', 'resolve'].includes(rule.kind)) {
      throw new Error(`warning rule ${rule.id} has unsupported kind ${rule.kind}`)
    }
    if (ids.has(rule.id)) throw new Error(`duplicate runtime trace policy id: ${rule.id}`)
    ids.add(rule.id)
    if (rule.pathPattern) new RegExp(rule.pathPattern, 'u')
    if (rule.specifierPattern) new RegExp(rule.specifierPattern, 'u')
  }
  for (const include of policy.explicitIncludes) {
    assertString(include.package, 'explicit include package')
    assertString(include.reason, `explicit include ${include.package} reason`)
    assertString(include.test, `explicit include ${include.package} test`)
  }
  for (const required of policy.requiredFiles) {
    assertString(required.id, 'required file id')
    assertString(required.package, `required file ${required.id} package`)
    assertString(required.path, `required file ${required.id} path`)
    if (path.isAbsolute(required.path) || required.path.split(/[\\/]/u).includes('..')) {
      throw new Error(`required file ${required.id} must stay inside its package`)
    }
  }
  return policy
}

export const packageNamesFromTracePath = (filePath) => {
  const parts = normalizePath(filePath).split('/')
  const names = []
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index] !== 'node_modules') continue
    const first = parts[index + 1]
    if (!first || first === '.pnpm') continue
    const name = first.startsWith('@') ? `${first}/${parts[index + 2] || ''}` : first
    if (name && !name.endsWith('/')) names.push(name)
  }
  return [...new Set(names)]
}

const parseWarning = (warning) => {
  const message = String(warning?.message || warning)
  const parseMatch = message.match(/^Failed to parse (.+?) as (?:script|module):/u)
  if (parseMatch) {
    const filePath = normalizePath(parseMatch[1])
    return {
      kind: 'parse',
      message,
      filePath,
      package: packageNamesFromTracePath(filePath).at(-1) || ''
    }
  }
  const resolveMatch = message.match(
    /^Failed to resolve dependency "([^"]+)":[\s\S]+? loaded from (.+)$/u
  )
  if (resolveMatch) {
    const importerPath = normalizePath(resolveMatch[2].trim())
    return {
      kind: 'resolve',
      message,
      specifier: resolveMatch[1],
      importerPath,
      package: packageNamesFromTracePath(importerPath).at(-1) || ''
    }
  }
  return { kind: 'unknown', message, package: '' }
}

const classifyWarning = (warning, rules) => {
  const parsed = parseWarning(warning)
  const rule = rules.find((candidate) => {
    if (candidate.kind !== parsed.kind) return false
    if (candidate.package && candidate.package !== parsed.package) return false
    if (
      candidate.packagePattern &&
      !new RegExp(candidate.packagePattern, 'u').test(parsed.package)
    ) {
      return false
    }
    if (
      candidate.pathPattern &&
      !new RegExp(candidate.pathPattern, 'u').test(parsed.filePath || '')
    ) {
      return false
    }
    if (
      candidate.specifierPattern &&
      !new RegExp(candidate.specifierPattern, 'u').test(parsed.specifier || '')
    ) {
      return false
    }
    return true
  })
  return { ...parsed, ruleId: rule?.id || null }
}

const findInstalledPackageJson = (rootDirectory, packageName) =>
  path.join(rootDirectory, 'node_modules', ...packageName.split('/'), 'package.json')

const readInstalledPackage = (rootDirectory, packageName) => {
  const packageJsonPath = findInstalledPackageJson(rootDirectory, packageName)
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`runtime dependency is not installed: ${packageName}`)
  }
  const manifest = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  if (!manifest.version) throw new Error(`runtime dependency has no version: ${packageName}`)
  return { manifest, packageJsonPath }
}

const collectOptionalPeerChecks = ({ rootDirectory, tracedFiles, recursivelyDiscoveredRoots }) => {
  const checks = new Map()
  for (const relativePath of tracedFiles) {
    if (!relativePath.endsWith('/package.json') && relativePath !== 'package.json') continue
    const absolutePath = path.join(rootDirectory, relativePath)
    if (!fs.existsSync(absolutePath)) continue
    let manifest
    try {
      manifest = JSON.parse(fs.readFileSync(absolutePath, 'utf8'))
    } catch {
      continue
    }
    for (const [peerName, metadata] of Object.entries(manifest.peerDependenciesMeta || {})) {
      if (!metadata?.optional || !recursivelyDiscoveredRoots.has(peerName)) continue
      const range = manifest.peerDependencies?.[peerName]
      if (!range) continue
      const installed = readInstalledPackage(rootDirectory, peerName).manifest.version
      if (!semver.satisfies(installed, range, { includePrerelease: true })) {
        throw new Error(
          `${manifest.name || absolutePath} requires optional peer ${peerName}@${range}, installed ${installed}`
        )
      }
      checks.set(`${manifest.name}:${peerName}`, {
        consumer: manifest.name,
        peer: peerName,
        range,
        installed
      })
    }
  }
  return [...checks.values()].sort((left, right) =>
    `${left.consumer}:${left.peer}`.localeCompare(`${right.consumer}:${right.peer}`)
  )
}

export const traceRuntimeDependencies = async ({
  rootDirectory,
  entryPaths,
  directPackageNames,
  policyPath,
  platform = process.platform,
  arch = process.arch
}) => {
  const root = path.resolve(rootDirectory)
  const policy = loadRuntimeTracePolicy(policyPath)
  const rootPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const entries = [...new Set(entryPaths.map((item) => path.resolve(item)))].sort()
  for (const entry of entries) {
    if (!entry.startsWith(`${root}${path.sep}`) || !fs.existsSync(entry)) {
      throw new Error(`runtime trace entry is invalid: ${entry}`)
    }
  }

  const trace = await nodeFileTrace(entries, {
    base: root,
    processCwd: root,
    mixedModules: true,
    ignore: policy.traceIgnore
  })
  const tracedFiles = [...trace.fileList].map(normalizePath).sort()
  const warnings = [...trace.warnings].map((warning) =>
    classifyWarning(warning, policy.warningRules)
  )
  const unknownWarnings = warnings.filter((warning) => !warning.ruleId)
  if (unknownWarnings.length > 0) {
    throw new Error(
      `runtime trace has ${String(unknownWarnings.length)} unclassified warning(s):\n${unknownWarnings
        .slice(0, 10)
        .map((warning) => warning.message)
        .join('\n\n')}`
    )
  }

  const tracedPackageNames = new Set(tracedFiles.flatMap(packageNamesFromTracePath))
  const direct = [...new Set(directPackageNames || [])].filter((name) => name !== 'electron')
  const runtimeRoots = new Set(direct)
  for (const name of Object.keys(rootPackage.dependencies || {})) {
    if (name !== 'electron' && tracedPackageNames.has(name)) runtimeRoots.add(name)
  }
  for (const include of policy.explicitIncludes) runtimeRoots.add(include.package)

  const missingRequiredRoots = policy.requiredFiles
    .filter((required) => !runtimeRoots.has(required.package))
    .map((required) => required.package)
  if (missingRequiredRoots.length > 0) {
    throw new Error(
      `runtime trace did not reach required packages: ${[...new Set(missingRequiredRoots)].join(', ')}`
    )
  }

  const undeclared = [...runtimeRoots].filter((name) => !rootPackage.dependencies?.[name]).sort()
  if (undeclared.length > 0) {
    throw new Error(
      `runtime trace found undeclared production dependencies: ${undeclared.join(', ')}`
    )
  }

  const packages = [...runtimeRoots].sort().map((name) => {
    const installed = readInstalledPackage(root, name)
    const sources = []
    if (direct.includes(name)) sources.push('bundle-import')
    if (tracedPackageNames.has(name)) sources.push('recursive-trace')
    if (policy.explicitIncludes.some((include) => include.package === name)) {
      sources.push('policy-include')
    }
    return {
      name,
      version: String(installed.manifest.version),
      sources,
      manifestSha256: sha256File(installed.packageJsonPath)
    }
  })

  const recursivelyDiscoveredRoots = new Set(
    [...runtimeRoots].filter((name) => !direct.includes(name))
  )

  const usedRuleIds = new Set(warnings.map((warning) => warning.ruleId))
  const unusedIncludes = policy.explicitIncludes.filter(
    (include) => !tracedPackageNames.has(include.package) && !direct.includes(include.package)
  )
  if (unusedIncludes.length > 0) {
    throw new Error(
      `runtime trace policy has unused explicit includes: ${unusedIncludes
        .map((include) => include.package)
        .join(', ')}`
    )
  }

  const report = {
    schemaVersion: 1,
    tracer: { name: '@vercel/nft', version: nftPackage.version },
    target: { platform, arch },
    entries: entries.map((entry) => ({
      path: normalizePath(path.relative(root, entry)),
      sha256: sha256File(entry)
    })),
    packages,
    optionalPeerChecks: collectOptionalPeerChecks({
      rootDirectory: root,
      tracedFiles,
      recursivelyDiscoveredRoots
    }),
    requiredFiles: policy.requiredFiles,
    trace: {
      fileCount: tracedFiles.length,
      files: tracedFiles,
      ignoredWarnings: warnings
        .map((warning) => ({
          ruleId: warning.ruleId,
          kind: warning.kind,
          package: warning.package,
          specifier: warning.specifier,
          path: warning.filePath ? normalizePath(path.relative(root, warning.filePath)) : undefined,
          message: normalizePath(warning.message).replaceAll(normalizePath(root), '<root>')
        }))
        .sort((left, right) =>
          `${left.ruleId}:${left.package}:${left.message}`.localeCompare(
            `${right.ruleId}:${right.package}:${right.message}`
          )
        ),
      usedWarningRules: [...usedRuleIds].sort()
    },
    policy: {
      path: normalizePath(path.relative(root, policyPath)),
      sha256: sha256File(policyPath),
      explicitIncludes: policy.explicitIncludes
    }
  }
  return report
}

export const writeRuntimeTraceReport = (reportPath, report) => {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}
