import { execFile, spawn } from 'node:child_process'
import { access, cp, mkdir, readFile, readdir } from 'node:fs/promises'
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
import { cleanupLocalTestLogs } from './shared/test-logs.mjs'
import { createReleaseStageDeadline } from './shared/stage-deadline.mjs'
import { prepareReleaseWorkspace } from './workspace.mjs'
import { parseReleaseTag } from './tag.mjs'
import { hasRegressionSelectionArgs, readRegressionSelection } from './regression.mjs'
import { assertLivePublishAllowed, resolveReleaseStorageConfig } from './storage/config.mjs'

const execFileAsync = promisify(execFile)
const ROOT = process.cwd()
const MACOS_PLATFORM = 'macos-arm64'
const stageDeadline = createReleaseStageDeadline('macOS release stage')
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
    'usage: node scripts/release/macos.mjs --tag <mac-v1.2.3> (--prepare-only|--test-only|--publish-only) [--domain <name>] [--suite <name>] [--group <name>] [--case <caseId> ...] [--fresh-knowledge-cache]'
  )
}
const mode = modes[0][0]
if (mode === 'publish') assertLivePublishAllowed()
if (mode !== 'test' && hasRegressionSelectionArgs(args)) {
  throw new Error('regression selection options are only valid with --test-only')
}

const run = (command, commandArgs, options = {}) =>
  new Promise((resolve, reject) => {
    const child = stageDeadline.track(
      spawn(command, commandArgs, {
        cwd: ROOT,
        env: process.env,
        stdio: 'inherit',
        ...options
      })
    )
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with ${code ?? signal}`))
    })
  })

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
    sidecarVenvRoot: path.join(defaultToolRoot, 'sidecar-venv'),
    sidecarPipCacheRoot: path.join(defaultToolRoot, 'sidecar-pip-cache')
  }

  if (mode === 'publish') {
    resolveReleaseStorageConfig()
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
    'R2_PUBLIC_BASE_URL',
    'TENCENT_SECRET_ID',
    'TENCENT_SECRET_KEY',
    'COS_BUCKET',
    'COS_REGION',
    'COS_PUBLIC_BASE_URL',
    'SecretId',
    'SecretKey',
    'NCURATOR_ALLOW_LIVE_PUBLISH'
  ]) {
    delete environment[name]
  }
  return environment
}

const runCandidateE2E = async ({ candidates, sourceDirectory, pnpmPath }) => {
  const resultPaths = candidates.map((candidate) =>
    path.join(candidate.directory, 'package-e2e-result.json')
  )
  try {
    await run(
      pnpmPath,
      [
        'run',
        'test:e2e:package',
        '--',
        ...candidates.flatMap((candidate, index) => [
          '--bundle',
          candidate.bundlePath,
          '--result',
          resultPaths[index]
        ]),
        ...regression.workflowArgs
      ],
      { cwd: sourceDirectory, env: sanitizedTestEnvironment() }
    )
    return await Promise.all(
      candidates.map((candidate, index) =>
        recordCandidateE2E({
          tag: releaseTag,
          platform: candidate.state.platform,
          status: 'passed',
          resultPath: resultPaths[index],
          selection: regression.state
        })
      )
    )
  } catch (error) {
    await Promise.all(
      candidates.map(async (candidate, index) => {
        let status = 'failed'
        try {
          const result = JSON.parse(await readFile(resultPaths[index], 'utf8'))
          if (result.status === 'passed') status = 'passed'
        } catch {
          // Missing or invalid evidence is a failed candidate result.
        }
        return await recordCandidateE2E({
          tag: releaseTag,
          platform: candidate.state.platform,
          status,
          resultPath: resultPaths[index],
          selection: regression.state
        })
      })
    )
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
  const sourceDirectory = path.join(workspace.workDirectory, 'arm64')
  try {
    await run('git', ['archive', '--format=tar', '--output', archivePath, releaseTag])
    await extractTag(archivePath, sourceDirectory)
    const buildEnvironment = {
      ...process.env,
      NCURATOR_SIDECAR_VENV_ROOT: tools.sidecarVenvRoot,
      NCURATOR_SIDECAR_PIP_CACHE: path.join(tools.sidecarPipCacheRoot, 'darwin-arm64')
    }
    await run(tools.pnpmPath, ['install', '--frozen-lockfile'], {
      cwd: sourceDirectory,
      env: buildEnvironment
    })
    await seedNativeCache(sourceDirectory)
    await run(tools.pnpmPath, ['run', 'build:mac:release:arm64'], {
      cwd: sourceDirectory,
      env: buildEnvironment
    })
    const candidate = await createCandidate(sourceDirectory, MACOS_PLATFORM, taggedCommit)
    process.stdout.write(
      `[release] macOS arm64 candidate prepared; package E2E is required before publish\n${candidate.bundlePath}\n`
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
    await seedNativeCache(sourceDirectory)
    const candidate = await readReleaseCandidate({ tag: releaseTag, platform: MACOS_PLATFORM })
    if (candidate.state.commit !== taggedCommit) {
      throw new Error(`${MACOS_PLATFORM} candidate commit does not match release tag`)
    }
    await runCandidateE2E({ candidates: [candidate], sourceDirectory, pnpmPath: tools.pnpmPath })
  } finally {
    await workspace.dispose()
  }
  process.stdout.write(`[release] macOS arm64 candidate E2E passed\n`)
  process.exit(0)
}

const candidate = await assertCandidatePublishable({
  tag: releaseTag,
  platform: MACOS_PLATFORM,
  commit: taggedCommit
})
await run(process.execPath, [
  path.join(ROOT, 'scripts', 'release', 'r2', 'upload-fragment.mjs'),
  candidate.verified.directory,
  candidate.verified.fragmentPath
])
await run(process.execPath, [
  path.join(ROOT, 'scripts', 'release', 'r2', 'finalize-macos.mjs'),
  '--tag',
  releaseTag
])
await markCandidatePublished({ tag: releaseTag, platform: MACOS_PLATFORM })
try {
  await cleanupLocalTestLogs(ROOT)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[release] local test log cleanup warning: ${message}\n`)
}
try {
  const removed = await cleanupSupersededReleaseCandidates({
    tag: releaseTag,
    platforms: [MACOS_PLATFORM]
  })
  if (removed.length > 0) {
    process.stdout.write(`[release] removed ${removed.length} superseded local candidate(s)\n`)
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[release] local candidate cleanup warning: ${message}\n`)
}
process.stdout.write(`[release] macOS ${releaseTag} published from retained candidates\n`)
