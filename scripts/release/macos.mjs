import { execFile, spawn } from 'node:child_process'
import { access, cp, mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { createReleaseBundle } from './artifact-bundle.mjs'
import {
  assertCandidatePublishable,
  cleanupSupersededReleaseCandidates,
  markCandidatePublished,
  materializeReleaseCandidate,
  readReleaseCandidate,
  recordCandidateE2E
} from './candidate.mjs'
import { loadReleaseEnvironment } from './shared/environment.mjs'
import { prepareReleaseWorkspace } from './workspace.mjs'
import { parseReleaseTag } from './tag.mjs'
import { hasRegressionSelectionArgs, readRegressionSelection } from './regression.mjs'

const execFileAsync = promisify(execFile)
const ROOT = process.cwd()
await loadReleaseEnvironment(ROOT)
const args = process.argv.slice(2)
const valueAfter = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const releaseTag = valueAfter('--tag') || ''
const regression = readRegressionSelection(args)
const modes = [
  ['prepare', args.includes('--prepare-only')],
  ['test', args.includes('--test-only')],
  ['publish', args.includes('--publish-only')]
].filter(([, enabled]) => enabled)

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('local macOS release must run on an Apple Silicon Mac')
}
let releaseVersion = ''
try {
  releaseVersion = parseReleaseTag(releaseTag, 'mac').version
} catch {
  // Report the complete command contract below.
}
if (!releaseVersion || modes.length !== 1) {
  throw new Error(
    'usage: node scripts/release/macos.mjs --tag <mac-v1.2.3> (--prepare-only|--test-only|--publish-only) [--domain <name>] [--suite <name>] [--group <name>] [--case <caseId>] [--fresh-knowledge-cache]'
  )
}
const mode = modes[0][0]
if (mode !== 'test' && hasRegressionSelectionArgs(args)) {
  throw new Error('regression selection options are only valid with --test-only')
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

const validateTag = async () => {
  const { stdout: tagType } = await execFileAsync('git', ['cat-file', '-t', releaseTag], {
    cwd: ROOT
  })
  if (tagType.trim() !== 'tag') throw new Error(`${releaseTag} must be an annotated tag`)
  const { stdout: packageJson } = await execFileAsync('git', ['show', `${releaseTag}:package.json`])
  const version = JSON.parse(packageJson).version
  if (releaseVersion !== version) {
    throw new Error(`${releaseTag} does not match package version ${version}`)
  }
  return (
    await execFileAsync('git', ['rev-list', '-n', '1', releaseTag], { cwd: ROOT })
  ).stdout.trim()
}

const validateEnvironment = async () => {
  const defaultToolRoot = path.join(process.env.HOME || '', '.ncurator', 'release-tools')
  const { stdout: pnpmPathOutput } = await execFileAsync('/usr/bin/which', ['pnpm'])
  const result = {
    pnpmPath: pnpmPathOutput.trim(),
    sidecarBrowserCacheRoot: path.join(defaultToolRoot, 'sidecar-browser-cache'),
    sidecarPipCacheRoot: path.join(defaultToolRoot, 'sidecar-pip-cache')
  }

  if (mode === 'publish') {
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
    if (
      String(process.env.R2_PUBLIC_BASE_URL).replace(/\/$/u, '') !== 'https://download.ncurator.com'
    ) {
      throw new Error('R2_PUBLIC_BASE_URL must be https://download.ncurator.com')
    }
    const awsExecutable =
      String(process.env.NCURATOR_AWS_CLI || '').trim() ||
      path.join(defaultToolRoot, 'awscli', 'bin', 'aws')
    await execFileAsync(awsExecutable, ['--version']).catch(() => {
      throw new Error('AWS CLI is not installed; install it before publishing macOS')
    })
    process.env.NCURATOR_AWS_CLI = awsExecutable
  }

  if (mode === 'prepare') {
    if (process.env.CSC_LINK && !process.env.CSC_IDENTITY_AUTO_DISCOVERY) {
      process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'true'
    }
    const { stdout: identities } = await execFileAsync('/usr/bin/security', [
      'find-identity',
      '-v',
      '-p',
      'codesigning'
    ])
    if (!identities.includes('Ncurator Update Signing')) {
      throw new Error('Ncurator Update Signing is not installed in the macOS login keychain')
    }
    result.x64Node =
      String(process.env.NCURATOR_X64_NODE || '').trim() ||
      path.join(defaultToolRoot, 'node-x64', 'bin', 'node')
    result.x64Python =
      String(process.env.NCURATOR_X64_PYTHON || '').trim() ||
      path.join(defaultToolRoot, 'python-x64', 'bin', 'python3')
    await assertExecutable(result.x64Node, 'NCURATOR_X64_NODE')
    await assertExecutable(result.x64Python, 'NCURATOR_X64_PYTHON')
    const { stdout: nodeArch } = await execFileAsync('/usr/bin/arch', [
      '-x86_64',
      result.x64Node,
      '-p',
      'process.arch'
    ])
    if (nodeArch.trim() !== 'x64') throw new Error('NCURATOR_X64_NODE is not x64')
    const { stdout: pythonArch } = await execFileAsync('/usr/bin/arch', [
      '-x86_64',
      result.x64Python,
      '-c',
      'import platform; print(platform.machine())'
    ])
    if (pythonArch.trim() !== 'x86_64') throw new Error('NCURATOR_X64_PYTHON is not x64')
  }
  return result
}

const findApp = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true })
  const match = entries.find((entry) => entry.isDirectory() && entry.name.endsWith('.app'))
  if (!match) throw new Error(`macOS app was not found under ${directory}`)
  return path.join(match.parentPath, match.name)
}

const extractTag = async (archivePath, directory) => {
  await mkdir(directory, { recursive: true })
  await run('/usr/bin/tar', ['-xf', archivePath, '-C', directory])
}

const seedNativeCache = async (sourceDirectory) => {
  const cacheSource = path.join(ROOT, 'node_modules', '.native-cache')
  const cacheTarget = path.join(sourceDirectory, 'node_modules', '.native-cache')
  const available = await access(cacheSource)
    .then(() => true)
    .catch(() => false)
  if (!available) return
  await cp(cacheSource, cacheTarget, { recursive: true, force: false })
}

const createCandidate = async (sourceDirectory, platform, commit) => {
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
  return await materializeReleaseCandidate({ bundlePath })
}

const sanitizedTestEnvironment = () => {
  const environment = { ...process.env }
  for (const name of [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'R2_ACCOUNT_ID',
    'R2_BUCKET_NAME',
    'R2_PUBLIC_BASE_URL'
  ]) {
    delete environment[name]
  }
  return environment
}

const runCandidateE2E = async ({ candidate, sourceDirectory, pnpmPath }) => {
  const resultPath = path.join(candidate.directory, 'package-e2e-result.json')
  try {
    await run(
      pnpmPath,
      [
        'run',
        'test:e2e:package',
        '--',
        '--bundle',
        candidate.bundlePath,
        '--result',
        resultPath,
        ...regression.workflowArgs
      ],
      { cwd: sourceDirectory, env: sanitizedTestEnvironment() }
    )
    return await recordCandidateE2E({
      tag: releaseTag,
      platform: candidate.state.platform,
      status: 'passed',
      resultPath,
      selection: regression.state
    })
  } catch (error) {
    await recordCandidateE2E({
      tag: releaseTag,
      platform: candidate.state.platform,
      status: 'failed',
      resultPath,
      selection: regression.state
    })
    throw error
  }
}

const taggedCommit = await validateTag()
const tools = await validateEnvironment()

if (mode === 'prepare') {
  const workspace = await prepareReleaseWorkspace({
    releaseTag,
    defaultRootName: 'ncurator-macos-prepare',
    keepWork: false
  })
  const archivePath = path.join(workspace.workDirectory, 'source.tar')
  const armSource = path.join(workspace.workDirectory, 'arm64')
  const x64Source = path.join(workspace.workDirectory, 'x64')
  try {
    await run('git', ['archive', '--format=tar', '--output', archivePath, releaseTag])
    await extractTag(archivePath, armSource)
    await extractTag(archivePath, x64Source)
    await run(tools.pnpmPath, ['install', '--frozen-lockfile'], { cwd: armSource })
    await seedNativeCache(armSource)
    await run(tools.pnpmPath, ['run', 'build:mac:release:arm64'], {
      cwd: armSource,
      env: {
        ...process.env,
        NCURATOR_SIDECAR_BROWSER_CACHE: path.join(tools.sidecarBrowserCacheRoot, 'darwin-arm64'),
        NCURATOR_SIDECAR_PIP_CACHE: path.join(tools.sidecarPipCacheRoot, 'darwin-arm64')
      }
    })
    const armCandidate = await createCandidate(armSource, 'macos-arm64', taggedCommit)

    const x64Environment = {
      ...process.env,
      PATH: `${path.dirname(tools.x64Node)}:${process.env.PATH || ''}`,
      PIP_CERT: String(process.env.PIP_CERT || '').trim() || '/private/etc/ssl/cert.pem',
      NCURATOR_SIDECAR_BUILD_PYTHON: tools.x64Python,
      NCURATOR_SIDECAR_BROWSER_CACHE: path.join(tools.sidecarBrowserCacheRoot, 'darwin-x64'),
      NCURATOR_SIDECAR_PIP_CACHE: path.join(tools.sidecarPipCacheRoot, 'darwin-x64')
    }
    await run(
      '/usr/bin/arch',
      ['-x86_64', tools.x64Node, tools.pnpmPath, 'install', '--frozen-lockfile'],
      { cwd: x64Source, env: x64Environment }
    )
    await seedNativeCache(x64Source)
    await run(
      '/usr/bin/arch',
      ['-x86_64', tools.x64Node, tools.pnpmPath, 'run', 'build:mac:release:x64'],
      { cwd: x64Source, env: x64Environment }
    )
    const x64Candidate = await createCandidate(x64Source, 'macos-x64', taggedCommit)
    process.stdout.write(
      `[release] macOS candidates prepared; impact assessment and package E2E are required before publish\n${armCandidate.bundlePath}\n${x64Candidate.bundlePath}\n`
    )
  } finally {
    await workspace.dispose()
  }
  process.exit(0)
}

if (mode === 'test') {
  const workspace = await prepareReleaseWorkspace({
    releaseTag,
    defaultRootName: 'ncurator-macos-test',
    keepWork: false
  })
  const archivePath = path.join(workspace.workDirectory, 'source.tar')
  const sourceDirectory = path.join(workspace.workDirectory, 'source')
  try {
    await run('git', ['archive', '--format=tar', '--output', archivePath, releaseTag])
    await extractTag(archivePath, sourceDirectory)
    await run(tools.pnpmPath, ['install', '--frozen-lockfile'], { cwd: sourceDirectory })
    for (const platform of ['macos-arm64', 'macos-x64']) {
      const candidate = await readReleaseCandidate({ tag: releaseTag, platform })
      if (candidate.state.commit !== taggedCommit) {
        throw new Error(`${platform} candidate commit does not match release tag`)
      }
      await runCandidateE2E({ candidate, sourceDirectory, pnpmPath: tools.pnpmPath })
    }
  } finally {
    await workspace.dispose()
  }
  process.stdout.write(`[release] macOS candidate E2E passed for both architectures\n`)
  process.exit(0)
}

const candidates = await Promise.all(
  ['macos-arm64', 'macos-x64'].map(async (platform) =>
    assertCandidatePublishable({ tag: releaseTag, platform, commit: taggedCommit })
  )
)
if (
  !candidates[0].verified.fragment.signature ||
  candidates[0].verified.fragment.signature !== candidates[1].verified.fragment.signature
) {
  throw new Error('macOS candidate signatures do not match')
}
for (const candidate of candidates) {
  await run(process.execPath, [
    path.join(ROOT, 'scripts', 'release', 'r2', 'upload-fragment.mjs'),
    candidate.verified.directory,
    candidate.verified.fragmentPath
  ])
}
await run(process.execPath, [
  path.join(ROOT, 'scripts', 'release', 'r2', 'finalize-macos.mjs'),
  '--tag',
  releaseTag
])
for (const platform of ['macos-arm64', 'macos-x64']) {
  await markCandidatePublished({ tag: releaseTag, platform })
}
try {
  const removed = await cleanupSupersededReleaseCandidates({
    tag: releaseTag,
    platforms: ['macos-arm64', 'macos-x64']
  })
  if (removed.length > 0) {
    process.stdout.write(`[release] removed ${removed.length} superseded local candidate(s)\n`)
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[release] local candidate cleanup warning: ${message}\n`)
}
process.stdout.write(`[release] macOS ${releaseTag} published from retained candidates\n`)
