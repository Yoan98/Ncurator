import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SIDECAR_DIR = path.join(ROOT, 'resources', 'web_crawler_sidecar')
const REQUIREMENTS_PATH = path.join(SIDECAR_DIR, 'requirements.txt')
const BUILD_SCRIPT_PATH = path.join(ROOT, 'scripts', 'build_web_crawler_sidecar.py')
const VENV_DIR = path.join(ROOT, '.runvenv', 'web_crawler_sidecar')
const STAMP_PATH = path.join(VENV_DIR, '.requirements.sha256')
const PLAYWRIGHT_BROWSER_STAMP_PATH = path.join(VENV_DIR, '.playwright-browser.sha256')
const PIP_CACHE_DIR = path.join(ROOT, '.pip-cache', 'web_crawler_sidecar')

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

const resolveBootstrapPython = () => {
  const override = String(process.env.NCURATOR_SIDECAR_BUILD_PYTHON || '').trim()
  if (override) {
    return {
      command: override,
      args: []
    }
  }

  const candidates =
    process.platform === 'win32'
      ? [
          { command: 'py', args: ['-3'] },
          { command: 'python', args: [] },
          { command: 'python3', args: [] }
        ]
      : [
          { command: 'python3', args: [] },
          { command: 'python', args: [] }
        ]

  for (const candidate of candidates) {
    if (canRun(candidate.command, [...candidate.args, '--version'])) {
      return candidate
    }
  }

  throw new Error(
    'No bootstrap Python was found. Set NCURATOR_SIDECAR_BUILD_PYTHON to a usable Python executable.'
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

const computeRequirementsHash = () =>
  crypto.createHash('sha256').update(fs.readFileSync(REQUIREMENTS_PATH)).digest('hex')

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

const ensureBundledPlaywrightBrowser = (pythonPath) => {
  const expectedHash = computeRequirementsHash()
  const installedHash = readInstalledPlaywrightBrowserHash()
  if (expectedHash === installedHash) {
    return
  }

  const browserEnv = {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: '0'
  }
  spawnChecked(pythonPath, ['-m', 'playwright', 'install', 'chromium'], { env: browserEnv })
  fs.writeFileSync(PLAYWRIGHT_BROWSER_STAMP_PATH, `${expectedHash}\n`, 'utf8')
}

const buildSidecar = (pythonPath) => {
  spawnChecked(pythonPath, [BUILD_SCRIPT_PATH])
}

const main = () => {
  if (!pathExists(REQUIREMENTS_PATH)) {
    throw new Error(`Missing sidecar requirements: ${REQUIREMENTS_PATH}`)
  }

  const bootstrapPython = resolveBootstrapPython()
  const venvPythonPath = ensureVenv(bootstrapPython)
  ensureSidecarDependencies(venvPythonPath)
  ensureBundledPlaywrightBrowser(venvPythonPath)
  buildSidecar(venvPythonPath)
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exit(1)
}
