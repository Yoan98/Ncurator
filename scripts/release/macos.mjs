import { execFile, spawn } from 'node:child_process'
import { access, mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { loadReleaseEnvironment } from './shared/environment.mjs'
import { prepareReleaseWorkspace } from './workspace.mjs'
import { createReleaseBundle, verifyReleaseBundle } from './artifact-bundle.mjs'

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
const packageE2E = args.includes('--package-e2e')

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('local macOS release must run on an Apple Silicon Mac')
}
if (!/^v\d+\.\d+\.\d+$/u.test(releaseTag)) {
  throw new Error('usage: node scripts/release/macos.mjs --tag <v1.2.3>')
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
  const match = entries.find((entry) => entry.isDirectory() && entry.name.endsWith('.app'))
  if (!match) throw new Error(`macOS app was not found under ${directory}`)
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

const createReleaseCandidate = async (sourceDirectory, platform, commit) => {
  const distDirectory = path.join(sourceDirectory, 'dist')
  const appPath = await findApp(distDirectory)
  await run(process.execPath, [
    path.join(sourceDirectory, 'scripts', 'release', 'verify-macos-signature.mjs'),
    appPath,
    path.join(distDirectory, 'mac-update-signature.txt')
  ])
  const fragmentPath = path.join(distDirectory, `${platform}.json`)
  await run(process.execPath, [
    path.join(sourceDirectory, 'scripts', 'release', 'r2', 'create-fragment.mjs'),
    distDirectory,
    fragmentPath,
    releaseTag,
    platform
  ])
  const bundlePath = path.join(distDirectory, `release-bundle-${platform}.json`)
  await createReleaseBundle({ fragmentPath, outputPath: bundlePath, commit })
  return { sourceDirectory, distDirectory, fragmentPath, bundlePath, platform }
}

const uploadReleaseCandidate = async (candidate) => {
  await verifyReleaseBundle(candidate.bundlePath, {
    tag: releaseTag,
    platform: candidate.platform
  })
  await run(process.execPath, [
    path.join(candidate.sourceDirectory, 'scripts', 'release', 'r2', 'upload-fragment.mjs'),
    candidate.distDirectory,
    candidate.fragmentPath
  ])
}

const preflight = await validatePreflight()
const releaseWorkspace = await prepareReleaseWorkspace({
  releaseTag,
  defaultRootName: 'ncurator-macos-release',
  keepWork
})
const { workDirectory } = releaseWorkspace
const archivePath = path.join(workDirectory, 'source.tar')
const armSource = path.join(workDirectory, 'arm64')
const x64Source = path.join(workDirectory, 'x64')

try {
  const { stdout: taggedCommitOutput } = await execFileAsync('git', [
    'rev-list',
    '-n',
    '1',
    releaseTag
  ])
  const taggedCommit = taggedCommitOutput.trim()
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
  const armCandidate = await createReleaseCandidate(armSource, 'macos-arm64', taggedCommit)

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
  const x64Candidate = await createReleaseCandidate(x64Source, 'macos-x64', taggedCommit)

  if (packageE2E) {
    const testEnvironment = { ...process.env }
    for (const name of [
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'R2_ACCOUNT_ID',
      'R2_BUCKET_NAME',
      'R2_PUBLIC_BASE_URL'
    ]) {
      delete testEnvironment[name]
    }
    for (const candidate of [armCandidate, x64Candidate]) {
      process.stdout.write(
        `[release] running package E2E for ${releaseTag} ${candidate.platform}\n`
      )
      await run(
        preflight.pnpmPath,
        ['run', 'test:e2e:package', '--', '--bundle', candidate.bundlePath],
        { cwd: armSource, env: testEnvironment }
      )
    }
  } else {
    process.stdout.write('[release] package E2E: skipped by release policy\n')
  }

  await uploadReleaseCandidate(armCandidate)
  await uploadReleaseCandidate(x64Candidate)

  const finalizeArgs = [
    path.join(armSource, 'scripts', 'release', 'r2', 'finalize-macos.mjs'),
    '--tag',
    releaseTag
  ]
  if (keepOld) finalizeArgs.push('--keep-old')
  await run(process.execPath, finalizeArgs, { cwd: armSource })
} finally {
  await releaseWorkspace.dispose()
}
