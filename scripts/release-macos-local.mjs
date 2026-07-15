/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { execFile, spawn } from 'node:child_process'
import { access, mkdir, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { loadReleaseEnvironment } from './release-environment.mjs'

const execFileAsync = promisify(execFile)
const ROOT = process.cwd()
await loadReleaseEnvironment(ROOT)
const args = process.argv.slice(2)
const valueAfter = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const releaseTag = valueAfter('--tag') || ''
const keepWork = args.includes('--keep-work')
const keepOld = args.includes('--keep-old')
const macOnly = args.includes('--mac-only')

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('local macOS release must run on an Apple Silicon Mac')
}
if (!/^v\d+\.\d+\.\d+$/u.test(releaseTag)) {
  throw new Error('usage: node scripts/release-macos-local.mjs --tag <v1.2.3>')
}

const run = (command, commandArgs, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
      ...options
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with ${code ?? signal}`))
    })
  })

const assertExecutable = async (filePath, label) => {
  if (!filePath) throw new Error(`${label} is not configured`)
  await access(filePath).catch(() => {
    throw new Error(`${label} does not exist: ${filePath}`)
  })
}

const findApp = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true })
  const match = entries.find((entry) => entry.isDirectory() && entry.name === 'Ncurator.app')
  if (!match) throw new Error(`Ncurator.app was not found under ${directory}`)
  return path.join(match.parentPath, match.name)
}

const validatePreflight = async () => {
  for (const name of [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'R2_ACCOUNT_ID',
    'R2_BUCKET_NAME',
    'R2_PUBLIC_BASE_URL'
  ]) {
    if (!String(process.env[name] || '').trim()) {
      throw new Error(`missing environment variable: ${name}`)
    }
  }
  if (process.env.CSC_LINK && !process.env.CSC_IDENTITY_AUTO_DISCOVERY) {
    process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'true'
  }
  if (
    String(process.env.R2_PUBLIC_BASE_URL).replace(/\/$/u, '') !== 'https://download.ncurator.com'
  ) {
    throw new Error('R2_PUBLIC_BASE_URL must be https://download.ncurator.com')
  }
  const defaultToolRoot = path.join(process.env.HOME || '', '.ncurator', 'release-tools')
  const sidecarBrowserCacheRoot = path.join(defaultToolRoot, 'sidecar-browser-cache')
  const sidecarPipCacheRoot = path.join(defaultToolRoot, 'sidecar-pip-cache')
  const awsExecutable =
    String(process.env.NCURATOR_AWS_CLI || '').trim() ||
    path.join(defaultToolRoot, 'awscli', 'bin', 'aws')
  await execFileAsync(awsExecutable, ['--version']).catch(() => {
    throw new Error('AWS CLI is not installed; install it before starting a local release')
  })
  process.env.NCURATOR_AWS_CLI = awsExecutable

  const { stdout: tagType } = await execFileAsync('git', ['cat-file', '-t', releaseTag], {
    cwd: ROOT
  })
  if (tagType.trim() !== 'tag') throw new Error(`${releaseTag} must be an annotated tag`)
  const { stdout: packageJson } = await execFileAsync('git', ['show', `${releaseTag}:package.json`])
  const version = JSON.parse(packageJson).version
  if (releaseTag !== `v${version}`)
    throw new Error(`${releaseTag} does not match package version ${version}`)

  const { stdout: identities } = await execFileAsync('/usr/bin/security', [
    'find-identity',
    '-v',
    '-p',
    'codesigning'
  ])
  if (!identities.includes('Ncurator Update Signing')) {
    throw new Error(
      'Ncurator Update Signing is not installed in the macOS login keychain; import and trust the fixed P12 certificate first'
    )
  }

  const x64Node =
    String(process.env.NCURATOR_X64_NODE || '').trim() ||
    path.join(defaultToolRoot, 'node-x64', 'bin', 'node')
  const x64Python =
    String(process.env.NCURATOR_X64_PYTHON || '').trim() ||
    path.join(defaultToolRoot, 'python-x64', 'bin', 'python3')
  await assertExecutable(x64Node, 'NCURATOR_X64_NODE')
  await assertExecutable(x64Python, 'NCURATOR_X64_PYTHON')
  const { stdout: nodeArch } = await execFileAsync('/usr/bin/arch', [
    '-x86_64',
    x64Node,
    '-p',
    'process.arch'
  ])
  if (nodeArch.trim() !== 'x64') throw new Error('NCURATOR_X64_NODE is not an x64 Node.js binary')
  const { stdout: pythonArch } = await execFileAsync('/usr/bin/arch', [
    '-x86_64',
    x64Python,
    '-c',
    'import platform; print(platform.machine())'
  ])
  if (pythonArch.trim() !== 'x86_64') {
    throw new Error('NCURATOR_X64_PYTHON is not an x64 Python binary')
  }
  const { stdout: pnpmPath } = await execFileAsync('/usr/bin/which', ['pnpm'])
  return {
    x64Node,
    x64Python,
    pnpmPath: pnpmPath.trim(),
    sidecarBrowserCacheRoot,
    sidecarPipCacheRoot
  }
}

const extractTag = async (archivePath, directory) => {
  await mkdir(directory, { recursive: true })
  await run('/usr/bin/tar', ['-xf', archivePath, '-C', directory])
}

const createAndUploadFragment = async (sourceDirectory, platform) => {
  const distDirectory = path.join(sourceDirectory, 'dist')
  const appPath = await findApp(distDirectory)
  await run(process.execPath, [
    path.join(sourceDirectory, 'scripts', 'verify-mac-update-signature.mjs'),
    appPath,
    path.join(distDirectory, 'mac-update-signature.txt')
  ])
  const fragmentPath = path.join(distDirectory, `${platform}.json`)
  await run(process.execPath, [
    path.join(sourceDirectory, 'scripts', 'create-release-fragment.mjs'),
    distDirectory,
    fragmentPath,
    releaseTag,
    platform
  ])
  await run(process.execPath, [
    path.join(sourceDirectory, 'scripts', 'upload-r2-release-fragment.mjs'),
    distDirectory,
    fragmentPath
  ])
}

const preflight = await validatePreflight()
const workRoot = path.resolve(
  String(process.env.NCURATOR_RELEASE_WORK_ROOT || '').trim() ||
    path.join(os.tmpdir(), 'ncurator-macos-release')
)
const workDirectory = path.join(workRoot, releaseTag)
const archivePath = path.join(workDirectory, 'source.tar')
const armSource = path.join(workDirectory, 'arm64')
const x64Source = path.join(workDirectory, 'x64')

await rm(workDirectory, { recursive: true, force: true })
await mkdir(workDirectory, { recursive: true })

try {
  await run('git', ['archive', '--format=tar', '--output', archivePath, releaseTag])
  await extractTag(archivePath, armSource)
  await extractTag(archivePath, x64Source)

  process.stdout.write(`[release] building ${releaseTag} for macOS arm64\n`)
  await run(preflight.pnpmPath, ['install', '--frozen-lockfile'], { cwd: armSource })
  await run(preflight.pnpmPath, ['run', 'build:mac:release:arm64'], {
    cwd: armSource,
    env: {
      ...process.env,
      NCURATOR_SIDECAR_BROWSER_CACHE: path.join(preflight.sidecarBrowserCacheRoot, 'darwin-arm64'),
      NCURATOR_SIDECAR_PIP_CACHE: path.join(preflight.sidecarPipCacheRoot, 'darwin-arm64')
    }
  })
  await createAndUploadFragment(armSource, 'macos-arm64')

  process.stdout.write(`[release] building ${releaseTag} for macOS x64 under Rosetta\n`)
  const x64Environment = {
    ...process.env,
    PATH: `${path.dirname(preflight.x64Node)}:${process.env.PATH || ''}`,
    PIP_CERT: String(process.env.PIP_CERT || '').trim() || '/private/etc/ssl/cert.pem',
    NCURATOR_SIDECAR_BUILD_PYTHON: preflight.x64Python,
    NCURATOR_SIDECAR_BROWSER_CACHE: path.join(preflight.sidecarBrowserCacheRoot, 'darwin-x64'),
    NCURATOR_SIDECAR_PIP_CACHE: path.join(preflight.sidecarPipCacheRoot, 'darwin-x64')
  }
  await run(
    '/usr/bin/arch',
    ['-x86_64', preflight.x64Node, preflight.pnpmPath, 'install', '--frozen-lockfile'],
    { cwd: x64Source, env: x64Environment }
  )
  await run(
    '/usr/bin/arch',
    ['-x86_64', preflight.x64Node, preflight.pnpmPath, 'run', 'build:mac:release:x64'],
    { cwd: x64Source, env: x64Environment }
  )
  await createAndUploadFragment(x64Source, 'macos-x64')

  const finalizeScript = macOnly ? 'finalize-r2-macos-release.mjs' : 'finalize-r2-release.mjs'
  const finalizeArgs = [path.join(armSource, 'scripts', finalizeScript), '--tag', releaseTag]
  if (keepOld && !macOnly) finalizeArgs.push('--keep-old')
  await run(process.execPath, finalizeArgs, { cwd: armSource })
} finally {
  if (keepWork) process.stdout.write(`[release] kept work directory ${workDirectory}\n`)
  else await rm(workDirectory, { recursive: true, force: true })
}
