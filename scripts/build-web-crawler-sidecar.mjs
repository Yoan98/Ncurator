/* eslint-disable @typescript-eslint/explicit-function-return-type */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SIDECAR_DIR = path.join(ROOT, 'resources', 'web_crawler_sidecar')
const SIDECAR_SCRIPT_PATH = path.join(SIDECAR_DIR, 'web_crawler_sidecar.py')
const REQUIREMENTS_PATH = path.join(SIDECAR_DIR, 'requirements.txt')
const BUILD_SCRIPT_PATH = path.join(ROOT, 'scripts', 'build_web_crawler_sidecar.py')
const THIS_SCRIPT_PATH = fileURLToPath(import.meta.url)
const VENV_DIR = path.join(
  ROOT,
  '.runvenv',
  `web_crawler_sidecar-${process.platform}-${process.arch}`
)
const STAMP_PATH = path.join(VENV_DIR, '.requirements.sha256')
const PLAYWRIGHT_BROWSER_STAMP_PATH = path.join(VENV_DIR, '.playwright-browser.sha256')
const PIP_CACHE_DIR = path.join(ROOT, '.pip-cache', 'web_crawler_sidecar')
const BIN_DIR = path.join(SIDECAR_DIR, 'bin')
const SOURCE_STAMP_PATH = path.join(BIN_DIR, '.source.sha256')
const SIDECAR_RUNTIME_LAYOUT_VERSION = 'headless-shell-v1'

const pathExists = (targetPath) => fs.existsSync(targetPath)

const getVenvPythonPath = () =>
  process.platform === 'win32'
    ? path.join(VENV_DIR, 'Scripts', 'python.exe')
    : path.join(VENV_DIR, 'bin', 'python')

const spawnChecked = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    ...options
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with code ${String(result.status)}`)
  }
}

const canRun = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'ignore'
  })
  if (result.error) {
    return false
  }
  return result.status === 0
}

const canRunSupportedPython = (command, args) =>
  canRun(command, [
    ...args,
    '-c',
    'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)'
  ])

const resolveBootstrapPython = () => {
  const override = String(process.env.NCURATOR_SIDECAR_BUILD_PYTHON || '').trim()
  if (override) {
    if (!canRunSupportedPython(override, [])) {
      throw new Error(`NCURATOR_SIDECAR_BUILD_PYTHON must point to Python >= 3.10: ${override}`)
    }
    return {
      command: override,
      args: []
    }
  }

  const candidates =
    process.platform === 'win32'
      ? [
          { command: 'python', args: [] },
          { command: 'python3', args: [] },
          { command: 'py', args: ['-3'] }
        ]
      : [
          { command: 'python3.12', args: [] },
          { command: 'python3.11', args: [] },
          { command: 'python3.10', args: [] },
          { command: 'python3', args: [] },
          { command: 'python', args: [] }
        ]

  for (const candidate of candidates) {
    if (canRunSupportedPython(candidate.command, candidate.args)) {
      return candidate
    }
  }

  throw new Error(
    'No Python >= 3.10 was found. Set NCURATOR_SIDECAR_BUILD_PYTHON to a usable Python executable.'
  )
}

const ensureVenv = (bootstrapPython) => {
  const venvPythonPath = getVenvPythonPath()
  if (pathExists(venvPythonPath)) {
    return venvPythonPath
  }

  fs.mkdirSync(path.dirname(VENV_DIR), { recursive: true })
  spawnChecked(bootstrapPython.command, [...bootstrapPython.args, '-m', 'venv', VENV_DIR])
  return venvPythonPath
}

const computeRequirementsHash = () => {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(REQUIREMENTS_PATH))
  hash.update(SIDECAR_RUNTIME_LAYOUT_VERSION)
  return hash.digest('hex')
}

const computeSourceHash = () => {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(SIDECAR_SCRIPT_PATH))
  hash.update(fs.readFileSync(REQUIREMENTS_PATH))
  hash.update(fs.readFileSync(BUILD_SCRIPT_PATH))
  hash.update(fs.readFileSync(THIS_SCRIPT_PATH))
  hash.update(SIDECAR_RUNTIME_LAYOUT_VERSION)
  return hash.digest('hex')
}

const hasCurrentBuiltSidecar = () => {
  if (!pathExists(SOURCE_STAMP_PATH)) return false
  if (fs.readFileSync(SOURCE_STAMP_PATH, 'utf8').trim() !== computeSourceHash()) return false
  const executableName =
    process.platform === 'win32' ? 'web_crawler_sidecar.exe' : 'web_crawler_sidecar'
  if (!pathExists(path.join(BIN_DIR, 'web_crawler_sidecar', executableName))) return false

  const browserRoots = []
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '.local-browsers') browserRoots.push(entryPath)
        else walk(entryPath)
      }
    }
  }
  walk(BIN_DIR)
  if (browserRoots.length !== 1) return false
  const browserNames = fs.readdirSync(browserRoots[0])
  return (
    !browserNames.some((name) => name.startsWith('chromium-')) &&
    browserNames.some((name) => name.startsWith('chromium_headless_shell-')) &&
    browserNames.some((name) => name.startsWith('ffmpeg-'))
  )
}

const readInstalledRequirementsHash = () =>
  pathExists(STAMP_PATH) ? fs.readFileSync(STAMP_PATH, 'utf8').trim() : ''

const readInstalledPlaywrightBrowserHash = () =>
  pathExists(PLAYWRIGHT_BROWSER_STAMP_PATH)
    ? fs.readFileSync(PLAYWRIGHT_BROWSER_STAMP_PATH, 'utf8').trim()
    : ''

const ensureSidecarDependencies = (pythonPath) => {
  const expectedHash = computeRequirementsHash()
  const installedHash = readInstalledRequirementsHash()
  if (expectedHash === installedHash) {
    return
  }

  fs.mkdirSync(PIP_CACHE_DIR, { recursive: true })
  const pipEnv = {
    ...process.env,
    PIP_CACHE_DIR,
    PIP_DISABLE_PIP_VERSION_CHECK: '1'
  }
  spawnChecked(pythonPath, ['-m', 'pip', 'install', '--upgrade', 'pip'], { env: pipEnv })
  spawnChecked(pythonPath, ['-m', 'pip', 'install', '-r', REQUIREMENTS_PATH], { env: pipEnv })
  fs.writeFileSync(STAMP_PATH, `${expectedHash}\n`, 'utf8')
}

const PLAYWRIGHT_BROWSER_CHECK_SNIPPET = [
  'import pathlib',
  'import playwright',
  "base = pathlib.Path(playwright.__file__).resolve().parent / 'driver' / 'package' / '.local-browsers'",
  "prefixes = ('chromium_headless_shell-', 'ffmpeg-')",
  'names = {item.name for item in base.iterdir()} if base.exists() else set()',
  "has_full_chromium = any(name.startswith('chromium-') for name in names)",
  'ok = not has_full_chromium and all(any(name.startswith(prefix) for name in names) for prefix in prefixes)',
  'raise SystemExit(0 if ok else 1)'
].join('\n')

const hasBundledPlaywrightBrowser = (pythonPath) =>
  canRun(pythonPath, ['-c', PLAYWRIGHT_BROWSER_CHECK_SNIPPET])

const resolveBundledPlaywrightBrowserDirectory = (pythonPath) => {
  const result = spawnSync(
    pythonPath,
    [
      '-c',
      "import pathlib, playwright; print(pathlib.Path(playwright.__file__).resolve().parent / 'driver' / 'package' / '.local-browsers')"
    ],
    { cwd: ROOT, encoding: 'utf8' }
  )
  if (result.error || result.status !== 0 || !result.stdout.trim()) {
    throw new Error('could not locate the bundled Playwright browser directory')
  }
  return result.stdout.trim()
}

const restoreBundledPlaywrightBrowserCache = (pythonPath) => {
  const source = String(process.env.NCURATOR_SIDECAR_BROWSER_CACHE || '').trim()
  if (!source || !pathExists(source)) return false

  const target = resolveBundledPlaywrightBrowserDirectory(pythonPath)
  fs.rmSync(target, { recursive: true, force: true })
  fs.cpSync(source, target, { recursive: true, force: true })
  for (const entry of fs.readdirSync(target)) {
    if (entry.startsWith('chromium-')) {
      fs.rmSync(path.join(target, entry), { recursive: true, force: true })
    }
  }
  return hasBundledPlaywrightBrowser(pythonPath)
}

const ensureBundledPlaywrightBrowser = (pythonPath) => {
  const expectedHash = computeRequirementsHash()
  const installedHash = readInstalledPlaywrightBrowserHash()
  // The stamp alone is not enough: an interrupted build can wipe the browser
  // bundle from the venv while the stamp still claims it is installed.
  if (expectedHash === installedHash && hasBundledPlaywrightBrowser(pythonPath)) {
    return
  }

  if (restoreBundledPlaywrightBrowserCache(pythonPath)) {
    fs.writeFileSync(PLAYWRIGHT_BROWSER_STAMP_PATH, `${expectedHash}\n`, 'utf8')
    return
  }

  const browserEnv = {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: '0',
    PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT: '300000'
  }
  spawnChecked(pythonPath, ['-m', 'playwright', 'install', '--only-shell', 'chromium'], {
    env: browserEnv
  })
  fs.writeFileSync(PLAYWRIGHT_BROWSER_STAMP_PATH, `${expectedHash}\n`, 'utf8')
}

const buildSidecar = (pythonPath) => {
  spawnChecked(pythonPath, [BUILD_SCRIPT_PATH])
}

const normalizeBundledPlaywrightSymlinks = () => {
  const browserRoots = []
  const symlinks = []
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) symlinks.push(entryPath)
      else if (entry.isDirectory()) {
        if (entry.name === '.local-browsers') browserRoots.push(entryPath)
        walk(entryPath)
      }
    }
  }
  walk(BIN_DIR)

  if (browserRoots.length !== 1) {
    throw new Error(
      `expected one bundled Playwright browser directory, found ${browserRoots.length}`
    )
  }
  const browserRoot = browserRoots[0]
  const marker = `${path.sep}.local-browsers${path.sep}`
  const cacheSourceValue = String(process.env.NCURATOR_SIDECAR_BROWSER_CACHE || '').trim()
  const cacheSource = cacheSourceValue ? path.resolve(cacheSourceValue) : ''
  for (const symlinkPath of symlinks) {
    const target = fs.readlinkSync(symlinkPath)
    if (!path.isAbsolute(target)) continue
    const markerIndex = target.lastIndexOf(marker)
    const isCachedTarget =
      cacheSource && (target === cacheSource || target.startsWith(`${cacheSource}${path.sep}`))
    if (markerIndex < 0 && !isCachedTarget) continue

    const suffix = isCachedTarget
      ? path.relative(cacheSource, target)
      : target.slice(markerIndex + marker.length)
    const bundledTarget = path.join(browserRoot, suffix)
    if (!pathExists(bundledTarget)) {
      throw new Error(`bundled Playwright symlink target does not exist: ${bundledTarget}`)
    }
    fs.unlinkSync(symlinkPath)
    fs.symlinkSync(path.relative(path.dirname(symlinkPath), bundledTarget), symlinkPath)
  }
}

const writeSourceStamp = () => {
  fs.mkdirSync(BIN_DIR, { recursive: true })
  fs.writeFileSync(SOURCE_STAMP_PATH, `${computeSourceHash()}\n`, 'utf8')
}

const main = () => {
  if (!pathExists(REQUIREMENTS_PATH)) {
    throw new Error(`Missing sidecar requirements: ${REQUIREMENTS_PATH}`)
  }

  if (hasCurrentBuiltSidecar()) {
    process.stdout.write(`[sidecar] current ${process.platform}-${process.arch} bundle reused\n`)
    return
  }

  const bootstrapPython = resolveBootstrapPython()
  const venvPythonPath = ensureVenv(bootstrapPython)
  ensureSidecarDependencies(venvPythonPath)
  ensureBundledPlaywrightBrowser(venvPythonPath)
  buildSidecar(venvPythonPath)
  normalizeBundledPlaywrightSymlinks()
  writeSourceStamp()
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exit(1)
}
