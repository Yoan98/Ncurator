import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { verifySidecarStartup } from './verify.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const SIDECAR_DIR = path.join(ROOT, 'resources', 'web_crawler_sidecar')
const SIDECAR_SCRIPT_PATH = path.join(SIDECAR_DIR, 'web_crawler_sidecar.py')
const REQUIREMENTS_PATH = path.join(SIDECAR_DIR, 'requirements.txt')
const BUILD_SCRIPT_PATH = path.join(ROOT, 'scripts', 'build', 'sidecar', 'build.py')
const THIS_SCRIPT_PATH = fileURLToPath(import.meta.url)
const VENV_ROOT = path.resolve(
  String(process.env.NCURATOR_SIDECAR_VENV_ROOT || '').trim() || path.join(ROOT, '.runvenv')
)
const VENV_DIR = path.join(VENV_ROOT, `web_crawler_sidecar-${process.platform}-${process.arch}`)
const STAMP_PATH = path.join(VENV_DIR, '.requirements.sha256')
const PIP_CACHE_DIR = path.resolve(
  String(process.env.NCURATOR_SIDECAR_PIP_CACHE || '').trim() ||
    path.join(ROOT, '.pip-cache', 'web_crawler_sidecar')
)
const BIN_DIR = path.join(SIDECAR_DIR, 'bin')
const EXECUTABLE_PATH = path.join(
  BIN_DIR,
  'web_crawler_sidecar',
  process.platform === 'win32' ? 'web_crawler_sidecar.exe' : 'web_crawler_sidecar'
)
const SOURCE_STAMP_PATH = path.join(BIN_DIR, '.source.sha256')
const SIDECAR_RUNTIME_LAYOUT_VERSION = 'electron-cdp-v1'

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
  hash.update(fs.readFileSync(new URL('./verify.mjs', import.meta.url)))
  hash.update(SIDECAR_RUNTIME_LAYOUT_VERSION)
  return hash.digest('hex')
}

const hasCurrentBuiltSidecar = () => {
  if (!pathExists(SOURCE_STAMP_PATH)) return false
  if (fs.readFileSync(SOURCE_STAMP_PATH, 'utf8').trim() !== computeSourceHash()) return false
  if (!pathExists(EXECUTABLE_PATH)) return false

  const forbiddenBrowserPaths = []
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      if (entry.name === '.local-browsers' || entry.name.startsWith('chromium_headless_shell-')) {
        forbiddenBrowserPaths.push(entryPath)
      }
      if (entry.isDirectory()) {
        walk(entryPath)
      }
    }
  }
  walk(BIN_DIR)
  return forbiddenBrowserPaths.length === 0
}

const readInstalledRequirementsHash = () =>
  pathExists(STAMP_PATH) ? fs.readFileSync(STAMP_PATH, 'utf8').trim() : ''

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

const buildSidecar = (pythonPath) => {
  spawnChecked(pythonPath, [BUILD_SCRIPT_PATH])
}

const writeSourceStamp = (sourceHash) => {
  fs.mkdirSync(BIN_DIR, { recursive: true })
  fs.writeFileSync(SOURCE_STAMP_PATH, `${sourceHash}\n`, 'utf8')
}

const main = () => {
  if (!pathExists(REQUIREMENTS_PATH)) {
    throw new Error(`Missing sidecar requirements: ${REQUIREMENTS_PATH}`)
  }

  if (hasCurrentBuiltSidecar()) {
    verifySidecarStartup(EXECUTABLE_PATH)
    process.stdout.write(`[sidecar] current ${process.platform}-${process.arch} bundle reused\n`)
    return
  }

  const bootstrapPython = resolveBootstrapPython()
  const sourceHash = computeSourceHash()
  const venvPythonPath = ensureVenv(bootstrapPython)
  ensureSidecarDependencies(venvPythonPath)
  buildSidecar(venvPythonPath)
  verifySidecarStartup(EXECUTABLE_PATH)
  writeSourceStamp(sourceHash)
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exit(1)
}
