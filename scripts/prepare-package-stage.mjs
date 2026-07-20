import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'
import { collectRuntimePackageNames } from './runtime-bundle-graph.mjs'
import { assertNodePtyNativeReleaseReady } from './node-pty-native-release.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STAGE_DIR = path.join(ROOT, 'release-stage', 'app')
const OUT_DIR = path.join(ROOT, 'out')
const DIST_DIR = path.join(ROOT, 'dist')
const ROOT_PACKAGE_PATH = path.join(ROOT, 'package.json')
const ROOT_LOCKFILE_PATH = path.join(ROOT, 'pnpm-lock.yaml')
const SIDECAR_BIN_DIR = path.join(ROOT, 'resources', 'web_crawler_sidecar', 'bin')
const NATIVE_RESOURCE_DIR = path.join(ROOT, 'resources', 'native')

const assertDirectory = (directory, label) => {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`${label} not found: ${directory}`)
  }
}

const listJavaScriptFiles = (directory) => {
  const result = []
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) walk(entryPath)
      else if (entry.isFile() && /\.(?:js|cjs|mjs)$/u.test(entry.name)) result.push(entryPath)
    }
  }
  walk(directory)
  return result
}

const resolveInstalledVersion = (packageName) => {
  const packageJsonPath = path.join(ROOT, 'node_modules', ...packageName.split('/'), 'package.json')
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`runtime dependency is not installed at the workspace root: ${packageName}`)
  }
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  const version = String(packageJson.version || '').trim()
  if (!version) throw new Error(`runtime dependency has no version: ${packageName}`)
  return version
}

const resolvePnpmCommand = () => {
  const npmExecPath = String(process.env.npm_execpath || '').trim()
  if (npmExecPath && /\.(?:c?js|mjs)$/u.test(npmExecPath)) {
    return { command: process.execPath, prefixArgs: [npmExecPath] }
  }
  return { command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', prefixArgs: [] }
}

const installRuntimeDependencies = () => {
  const pnpm = resolvePnpmCommand()
  const args = [
    ...pnpm.prefixArgs,
    'install',
    '--prod',
    '--ignore-scripts',
    '--ignore-workspace',
    '--frozen-lockfile',
    '--offline',
    '--package-import-method',
    'copy',
    '--config.node-linker=hoisted',
    '--config.auto-install-peers=false'
  ]
  const result = spawnSync(pnpm.command, args, {
    cwd: STAGE_DIR,
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`staging dependency install failed with code ${String(result.status)}`)
  }
}

const installPreparedNodePtyNative = () => {
  const prebuildDirectory = `${process.platform}-${process.arch}`
  const prebuildSource = path.join(ROOT, 'node_modules', 'node-pty', 'prebuilds', prebuildDirectory)
  if (fs.existsSync(prebuildSource)) {
    const prebuildTarget = path.join(
      STAGE_DIR,
      'node_modules',
      'node-pty',
      'prebuilds',
      prebuildDirectory
    )
    fs.rmSync(prebuildTarget, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(prebuildTarget), { recursive: true })
    fs.cpSync(prebuildSource, prebuildTarget, { recursive: true, force: true })
    assertNodePtyNativeReleaseReady(prebuildTarget, 'staged node-pty prebuild')
    return
  }
  const source = path.join(ROOT, 'node_modules', 'node-pty', 'build', 'Release')
  const target = path.join(STAGE_DIR, 'node_modules', 'node-pty', 'build', 'Release')
  assertDirectory(source, 'prepared node-pty native release')
  fs.rmSync(target, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.cpSync(source, target, { recursive: true, force: true })
  assertNodePtyNativeReleaseReady(target, 'staged node-pty native release')
}

const collectInstalledTopLevelDependencies = () => {
  const nodeModules = path.join(STAGE_DIR, 'node_modules')
  const packageDirectories = []
  for (const entry of fs.readdirSync(nodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const entryPath = path.join(nodeModules, entry.name)
    if (!entry.name.startsWith('@')) {
      packageDirectories.push(entryPath)
      continue
    }
    for (const scopedEntry of fs.readdirSync(entryPath, { withFileTypes: true })) {
      if (scopedEntry.isDirectory()) packageDirectories.push(path.join(entryPath, scopedEntry.name))
    }
  }

  const dependencies = {}
  for (const directory of packageDirectories) {
    const packageJsonPath = path.join(directory, 'package.json')
    if (!fs.existsSync(packageJsonPath)) continue
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
    const name = String(packageJson.name || '').trim()
    const version = String(packageJson.version || '').trim()
    if (!name || !version) {
      throw new Error(`installed runtime package has invalid metadata: ${directory}`)
    }
    dependencies[name] = version
  }
  return Object.fromEntries(
    Object.entries(dependencies).sort(([left], [right]) => left.localeCompare(right))
  )
}

const REMOVE_DIRECTORY_NAMES = new Set([
  '.changeset',
  '.circleci',
  '.github',
  '.claude',
  '.history',
  '.husky',
  '.idea',
  '.vscode',
  '__tests__',
  'benchmarks',
  'benchmark',
  'coverage',
  'docs',
  'doc',
  'examples',
  'example',
  'scripts',
  'tests',
  'test'
])

const REMOVE_EXTENSIONS = new Set([
  '.adoc',
  '.bat',
  '.map',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.tsbuildinfo',
  '.jsx',
  '.vue',
  '.svelte',
  '.py',
  '.pyc',
  '.pyo',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.fs',
  '.fsx',
  '.go',
  '.java',
  '.kt',
  '.kts',
  '.m',
  '.mm',
  '.php',
  '.rb',
  '.rs',
  '.scala',
  '.swift',
  '.vb',
  '.gyp',
  '.gypi',
  '.gradle',
  '.sln',
  '.vcxproj',
  '.sh',
  '.ps1',
  '.cmd',
  '.flow',
  '.jsdoc',
  '.patch',
  '.orig',
  '.md',
  '.markdown',
  '.rst',
  '.pdb'
])

const isLegalNotice = (name) =>
  /^(?:license|licence|notice|copying)(?:[._-].*)?$/u.test(name) ||
  /^(?:apache2?|bsd|mit)$/u.test(name)

const isDocumentationFile = (name) =>
  /^(?:readme|changelog|history)(?:\.(?:adoc|md|markdown|rst|txt))?$/u.test(name)

const shouldRemoveFile = (filePath) => {
  const name = path.basename(filePath).toLowerCase()
  if (isLegalNotice(name)) return false
  if (REMOVE_EXTENSIONS.has(path.extname(name))) return true
  return (
    /\.(?:spec|test)\.[^.]+$/u.test(name) ||
    /^tsconfig(?:\.[^.]+)?\.json$/u.test(name) ||
    isDocumentationFile(name) ||
    name === '.npmignore' ||
    name === '.ds_store' ||
    name === '.editorconfig' ||
    name === '.eslintignore' ||
    name === '.flowconfig' ||
    name === '.gitattributes' ||
    name === '.gitignore' ||
    name === '.gitkeep' ||
    name === '.keep' ||
    name === '.nojekyll' ||
    name === '.nycrc' ||
    name === '.prettierignore' ||
    name === '.taprc' ||
    name.startsWith('.eslintrc') ||
    name.startsWith('.prettierrc') ||
    name === 'yarn.lock' ||
    name === 'package-lock.json' ||
    name === 'pnpm-lock.yaml'
  )
}

const pruneCompiledOutput = () => {
  const output = path.join(STAGE_DIR, 'out')
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(entryPath)
      else if (entry.isFile() && shouldRemoveFile(entryPath)) {
        fs.rmSync(entryPath, { force: true })
      }
    }
  }
  walk(output)
}

const stripSourceMapReferences = () => {
  const textExtensions = new Set(['.js', '.cjs', '.mjs', '.css'])
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(entryPath)
        continue
      }
      if (!entry.isFile() || !textExtensions.has(path.extname(entry.name).toLowerCase())) continue
      const source = fs.readFileSync(entryPath, 'utf8')
      const stripped = source
        .replace(/\/\/[#@]\s*sourceMappingURL\s*=.*?(?=\r?\n|$)/gu, '')
        .replace(/\/\*[#@]\s*sourceMappingURL\s*=.*?\*\//gsu, '')
      if (stripped !== source) fs.writeFileSync(entryPath, stripped, 'utf8')
    }
  }
  walk(STAGE_DIR)
}

const pruneNodeModules = () => {
  const nodeModules = path.join(STAGE_DIR, 'node_modules')
  const targetPrebuildDirectory = `${process.platform}-${process.arch}`
  const supportsCurrentTarget = (values, current) => {
    if (!Array.isArray(values) || values.length === 0) return true
    const normalized = values.map((value) => String(value).trim()).filter(Boolean)
    if (normalized.includes(`!${current}`)) return false
    const allowed = normalized.filter((value) => !value.startsWith('!'))
    return allowed.length === 0 || allowed.includes(current)
  }
  const isIncompatiblePackage = (directory) => {
    const packageJsonPath = path.join(directory, 'package.json')
    if (!fs.existsSync(packageJsonPath)) return false
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
    return (
      !supportsCurrentTarget(packageJson.os, process.platform) ||
      !supportsCurrentTarget(packageJson.cpu, process.arch)
    )
  }
  const prunePlatformPrebuilds = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (!/^(?:darwin|linux|win32)-(?:arm64|ia32|x64)$/u.test(entry.name)) continue
      if (entry.name !== targetPrebuildDirectory) {
        fs.rmSync(path.join(directory, entry.name), { recursive: true, force: true })
      }
    }
  }
  const reducePackageToManifest = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isFile() && ['package.json', 'LICENSE', 'NOTICE'].includes(entry.name)) continue
      fs.rmSync(path.join(directory, entry.name), { recursive: true, force: true })
    }
  }
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      const lowerName = entry.name.toLowerCase()
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (isIncompatiblePackage(entryPath)) {
          fs.rmSync(entryPath, { recursive: true, force: true })
          continue
        }
        if (lowerName === 'prebuilds') {
          prunePlatformPrebuilds(entryPath)
        }
        if (lowerName === 'onnxruntime-web') {
          reducePackageToManifest(entryPath)
          continue
        }
        if (
          REMOVE_DIRECTORY_NAMES.has(lowerName) ||
          (directory === nodeModules && lowerName === '.bin')
        ) {
          fs.rmSync(entryPath, { recursive: true, force: true })
          continue
        }
        walk(entryPath)
        if (fs.existsSync(entryPath) && fs.readdirSync(entryPath).length === 0) {
          fs.rmdirSync(entryPath)
        }
      } else if (entry.isFile() && shouldRemoveFile(entryPath)) {
        fs.rmSync(entryPath, { force: true })
      }
    }
  }
  walk(nodeModules)

  const onnxRoot = path.join(nodeModules, 'onnxruntime-node', 'bin', 'napi-v3')
  if (fs.existsSync(onnxRoot)) {
    const expectedPlatform = process.platform
    const expectedArch = process.arch
    for (const platformEntry of fs.readdirSync(onnxRoot, { withFileTypes: true })) {
      const platformPath = path.join(onnxRoot, platformEntry.name)
      if (!platformEntry.isDirectory()) continue
      if (platformEntry.name !== expectedPlatform) {
        fs.rmSync(platformPath, { recursive: true, force: true })
        continue
      }
      for (const archEntry of fs.readdirSync(platformPath, { withFileTypes: true })) {
        if (archEntry.isDirectory() && archEntry.name !== expectedArch) {
          fs.rmSync(path.join(platformPath, archEntry.name), { recursive: true, force: true })
        }
      }
    }
    const expectedBinaryDirectory = path.join(onnxRoot, expectedPlatform, expectedArch)
    assertDirectory(expectedBinaryDirectory, 'target ONNX Runtime binary directory')
  }

  const transformersDist = path.join(nodeModules, '@huggingface', 'transformers', 'dist')
  if (fs.existsSync(transformersDist)) {
    for (const entry of fs.readdirSync(transformersDist, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.wasm')) {
        fs.rmSync(path.join(transformersDist, entry.name), { force: true })
      }
    }
  }
}

const pruneStagedResources = () => {
  const resources = path.join(STAGE_DIR, 'resources')
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      const lowerName = entry.name.toLowerCase()
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (
          REMOVE_DIRECTORY_NAMES.has(lowerName) ||
          lowerName === 'patchright' ||
          lowerName === 'types' ||
          lowerName.startsWith('chromium-')
        ) {
          fs.rmSync(entryPath, { recursive: true, force: true })
          continue
        }
        walk(entryPath)
      } else if (entry.isFile() && shouldRemoveFile(entryPath)) {
        fs.rmSync(entryPath, { force: true })
      }
    }
  }
  walk(resources)
}

const writeStageLockfile = (runtimeDependencies) => {
  const lockfile = parse(fs.readFileSync(ROOT_LOCKFILE_PATH, 'utf8'))
  const rootImporter = lockfile.importers?.['.']
  if (!rootImporter?.dependencies) throw new Error('workspace lockfile has no root dependencies')
  const dependencies = {}
  for (const [name, version] of Object.entries(runtimeDependencies)) {
    const locked = rootImporter.dependencies[name]
    if (!locked) throw new Error(`runtime dependency is missing from pnpm-lock.yaml: ${name}`)
    dependencies[name] = { ...locked, specifier: version }
  }
  lockfile.settings = { ...lockfile.settings, autoInstallPeers: false }
  lockfile.importers = { '.': { dependencies } }
  fs.writeFileSync(path.join(STAGE_DIR, 'pnpm-lock.yaml'), stringify(lockfile), 'utf8')
}

const main = () => {
  assertDirectory(OUT_DIR, 'compiled application output')
  assertDirectory(SIDECAR_BIN_DIR, 'web crawler sidecar binary')
  assertDirectory(NATIVE_RESOURCE_DIR, 'native resource directory')

  const rootPackage = JSON.parse(fs.readFileSync(ROOT_PACKAGE_PATH, 'utf8'))
  const runtimeEntries = [
    ...listJavaScriptFiles(path.join(OUT_DIR, 'main')),
    ...listJavaScriptFiles(path.join(OUT_DIR, 'preload'))
  ]
  const runtimePackageNames = collectRuntimePackageNames(runtimeEntries)
  const undeclared = runtimePackageNames.filter((name) => !rootPackage.dependencies?.[name])
  if (undeclared.length > 0) {
    throw new Error(`runtime bundles import undeclared dependencies: ${undeclared.join(', ')}`)
  }

  const runtimeDependencies = Object.fromEntries(
    runtimePackageNames.map((name) => [name, resolveInstalledVersion(name)])
  )
  const stagePackage = {
    name: rootPackage.name,
    version: rootPackage.version,
    description: rootPackage.description,
    main: './out/main/index.js',
    author: rootPackage.author,
    homepage: rootPackage.homepage,
    private: true,
    dependencies: runtimeDependencies
  }

  fs.rmSync(DIST_DIR, { recursive: true, force: true })
  fs.rmSync(STAGE_DIR, { recursive: true, force: true })
  fs.mkdirSync(STAGE_DIR, { recursive: true })
  fs.cpSync(OUT_DIR, path.join(STAGE_DIR, 'out'), { recursive: true, force: true })
  fs.mkdirSync(path.join(STAGE_DIR, 'resources', 'web_crawler_sidecar'), { recursive: true })
  fs.cpSync(SIDECAR_BIN_DIR, path.join(STAGE_DIR, 'resources', 'web_crawler_sidecar', 'bin'), {
    recursive: true,
    force: true,
    verbatimSymlinks: true
  })
  fs.cpSync(NATIVE_RESOURCE_DIR, path.join(STAGE_DIR, 'resources', 'native'), {
    recursive: true,
    force: true,
    verbatimSymlinks: true
  })
  fs.rmSync(path.join(STAGE_DIR, 'resources', 'web_crawler_sidecar', 'bin', '.source.sha256'), {
    force: true
  })
  fs.writeFileSync(
    path.join(STAGE_DIR, 'package.json'),
    `${JSON.stringify(stagePackage, null, 2)}\n`
  )
  writeStageLockfile(runtimeDependencies)

  installRuntimeDependencies()
  if (runtimePackageNames.includes('node-pty')) installPreparedNodePtyNative()
  fs.rmSync(path.join(STAGE_DIR, 'pnpm-lock.yaml'), { force: true })
  pruneCompiledOutput()
  pruneNodeModules()
  pruneStagedResources()
  const packagedDependencies = collectInstalledTopLevelDependencies()
  fs.writeFileSync(
    path.join(STAGE_DIR, 'package.json'),
    `${JSON.stringify({ ...stagePackage, dependencies: packagedDependencies }, null, 2)}\n`
  )
  stripSourceMapReferences()

  const audit = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'audit-package-stage.mjs'), STAGE_DIR],
    { cwd: ROOT, stdio: 'inherit' }
  )
  if (audit.error) throw audit.error
  if (audit.status !== 0) throw new Error('staging package security audit failed')

  process.stdout.write(
    `[package] staging ready for ${process.platform}-${process.arch}; runtime roots: ${runtimePackageNames.join(', ')}; packaged dependencies: ${String(Object.keys(packagedDependencies).length)}\n`
  )
}

main()
