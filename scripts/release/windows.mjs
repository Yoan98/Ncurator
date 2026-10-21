import { DISTRIBUTIONS } from './shared/distribution.mjs'
import { execFile, spawn } from 'node:child_process'
import os from 'node:os'
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
import { inspectLocalWindowsRelease } from './shared/windows.mjs'
import { assertLivePublishAllowed } from './storage/config.mjs'
import { prepareReleaseWorkspace } from './workspace.mjs'
import { parseReleaseTag } from './tag.mjs'
import {
  hasRegressionSelectionArgs,
  readRegressionSelection,
  validateReleaseArgs
} from './regression.mjs'
import { cleanupLocalTestLogs, preserveReleaseTestLogs } from './shared/test-logs.mjs'
import { createReleaseStageDeadline } from './shared/stage-deadline.mjs'
import { loadReleaseEnvironment } from './shared/environment.mjs'
import { createGitHubReleasePublisher } from './github.mjs'
import { prepareReleaseStoragePublication, publishReleaseStorage } from './storage/publish.mjs'
import { cpSync, existsSync } from 'node:fs'

const execFileAsync = promisify(execFile)
const ROOT = process.cwd()
await loadReleaseEnvironment(ROOT)
const stageDeadline = createReleaseStageDeadline('Windows release stage')
const args = process.argv.slice(2)
const valueAfter = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const releaseTag = valueAfter('--tag') || ''
validateReleaseArgs(args)
const regression = readRegressionSelection(args)
const modes = [
  ['prepare', args.includes('--prepare-only')],
  ['test', args.includes('--test-only')],
  ['publish', args.includes('--publish-only')]
].filter(([, enabled]) => enabled)

let releaseVersion = ''
try {
  releaseVersion = parseReleaseTag(releaseTag, 'windows').version
} catch {
  // Report the complete command contract below.
}
if (!releaseVersion || modes.length !== 1) {
  throw new Error(
    'usage: node scripts/release/windows.mjs --tag <windows-v1.2.3> (--prepare-only|--test-only|--publish-only) [--domain <name>] [--suite <name>] [--group <name>] [--case <caseId> ...] [--fresh-knowledge-cache]'
  )
}
const mode = modes[0][0]
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
        shell: process.platform === 'win32' && /\.(cmd|bat)$/iu.test(command),
        ...options
      })
    )
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with ${code ?? signal}`))
    })
  })

const requirePublish = mode === 'publish'
if (requirePublish) assertLivePublishAllowed()
const inspection = await inspectLocalWindowsRelease(ROOT, { requirePublish })
if (!inspection.ready) {
  throw new Error(`local Windows release is unavailable:\n- ${inspection.issues.join('\n- ')}`)
}

const { stdout: tagType } = await execFileAsync('git', ['cat-file', '-t', releaseTag], {
  cwd: ROOT
})
if (tagType.trim() !== 'tag') throw new Error(`${releaseTag} must be an annotated tag`)
const { stdout: taggedPackageJson } = await execFileAsync('git', [
  'show',
  `${releaseTag}:package.json`
])
const taggedVersion = JSON.parse(taggedPackageJson).version
if (releaseVersion !== taggedVersion) {
  throw new Error(`${releaseTag} does not match package version ${taggedVersion}`)
}
const { stdout: taggedCommitOutput } = await execFileAsync('git', [
  'rev-list',
  '-n',
  '1',
  releaseTag
])
const taggedCommit = taggedCommitOutput.trim()

const cleanupLocalCandidates = async () => {
  try {
    const removed = await cleanupSupersededReleaseCandidates({
      tag: releaseTag,
      platforms: ['windows-x64']
    })
    if (removed.length > 0) {
      process.stdout.write(`[release] removed ${removed.length} superseded local candidate(s)\n`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[release] local candidate cleanup warning: ${message}\n`)
  }
}

const cleanupLocalTestLogsSafely = async () => {
  try {
    await cleanupLocalTestLogs(ROOT)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[release] local test log cleanup warning: ${message}\n`)
  }
}

const releaseEnvironment = () => {
  const environment = {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY:
      String(process.env.CSC_IDENTITY_AUTO_DISCOVERY || '').trim() || 'false',
    NCURATOR_SIDECAR_VENV_ROOT:
      String(process.env.NCURATOR_SIDECAR_VENV_ROOT || '').trim() ||
      path.join(os.homedir(), '.ncurator', 'release-tools', 'sidecar-venv'),
    NCURATOR_SIDECAR_BUILD_PYTHON:
      String(process.env.NCURATOR_SIDECAR_BUILD_PYTHON || '').trim() || inspection.python.executable
  }
  for (const name of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD']) {
    delete environment[name]
  }
  return environment
}

const testEnvironment = (environment) => {
  const sanitized = { ...environment }
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
    delete sanitized[name]
  }
  return sanitized
}

const seedNativeCacheFromRoot = (sourceDirectory) => {
  const relativeCache = path.join('node_modules', '.native-cache')
  const from = path.join(ROOT, relativeCache)
  const to = path.join(sourceDirectory, relativeCache)
  if (!existsSync(from)) return
  cpSync(from, to, { recursive: true, force: true })
  process.stdout.write(`[release] seeded native cache into test worktree from ${relativeCache}\n`)
}

const extractTagSource = async (defaultRootName) => {
  const workspace = await prepareReleaseWorkspace({
    releaseTag,
    defaultRootName,
    keepWork: false
  })
  const sourceDirectory = path.join(workspace.workDirectory, 'source')
  await run('git', ['worktree', 'add', '--detach', sourceDirectory, releaseTag])
  return {
    sourceDirectory,
    workspace: {
      dispose: async () => {
        try {
          await run('git', ['worktree', 'remove', '--force', sourceDirectory])
        } catch (error) {
          await workspace.dispose()
          await run('git', ['worktree', 'prune', '--expire', 'now'])
          const message = error instanceof Error ? error.message : String(error)
          process.stderr.write(`[release] worktree cleanup recovered after: ${message}\n`)
          return
        }
        await workspace.dispose()
      }
    }
  }
}

const runCandidateE2E = async ({ candidate, sourceDirectory, environment }) => {
  const resultPath = path.join(candidate.directory, 'package-e2e-result.json')
  try {
    await run(
      process.execPath,
      [
        path.join(sourceDirectory, 'scripts', 'release', 'regression.mjs'),
        candidate.bundlePath,
        resultPath,
        ...regression.workflowArgs
      ],
      { cwd: sourceDirectory, env: testEnvironment(environment) }
    )
    return await recordCandidateE2E({
      tag: releaseTag,
      platform: 'windows-x64',
      status: 'passed',
      resultPath,
      selection: regression.state
    })
  } catch (error) {
    await recordCandidateE2E({
      tag: releaseTag,
      platform: 'windows-x64',
      status: 'failed',
      resultPath,
      selection: regression.state
    })
    throw error
  }
}

if (mode === 'prepare') {
  const { workspace, sourceDirectory } = await extractTagSource('p')
  try {
    const environment = releaseEnvironment()
    await run(inspection.pnpmExecutable, ['install', '--frozen-lockfile'], {
      cwd: sourceDirectory,
      env: environment
    })
    await run(inspection.pnpmExecutable, ['run', 'build:win'], {
      cwd: sourceDirectory,
      env: environment
    })
    for (const distribution of DISTRIBUTIONS) {
      const distDirectory = path.join(sourceDirectory, 'dist', distribution)
      const fragmentPath = path.join(distDirectory, 'windows-x64.json')
      await run(
        process.execPath,
        [
          path.join(sourceDirectory, 'scripts', 'release', 'r2', 'create-fragment.mjs'),
          distDirectory,
          fragmentPath,
          releaseTag,
          'windows-x64',
          distribution
        ],
        { cwd: sourceDirectory, env: environment }
      )
      const bundlePath = path.join(distDirectory, 'release-bundle-windows-x64.json')
      await createReleaseBundle({ fragmentPath, outputPath: bundlePath, commit: taggedCommit })
      const candidate = await materializeReleaseCandidate({ bundlePath })
      process.stdout.write(
        `[release] ${distribution} candidate prepared: ${candidate.bundlePath}\n`
      )
    }
  } finally {
    await workspace.dispose()
  }
  process.exit(0)
}

if (mode === 'test') {
  let candidate = await readReleaseCandidate({ tag: releaseTag, platform: 'windows-x64' })
  if (candidate.state.commit !== taggedCommit) {
    throw new Error('candidate commit does not match release tag')
  }
  const { workspace, sourceDirectory } = await extractTagSource('t')
  try {
    const environment = releaseEnvironment()
    await run(inspection.pnpmExecutable, ['install', '--frozen-lockfile'], {
      cwd: sourceDirectory,
      env: environment
    })
    seedNativeCacheFromRoot(sourceDirectory)
    candidate = await runCandidateE2E({ candidate, sourceDirectory, environment })
    process.stdout.write(`[release] candidate E2E passed: ${candidate.bundlePath}\n`)
  } finally {
    await preserveReleaseTestLogs(sourceDirectory, ROOT)
    await workspace.dispose()
  }
  process.exit(0)
}

const candidates = []
for (const distribution of DISTRIBUTIONS) {
  candidates.push(
    await assertCandidatePublishable({
      tag: releaseTag,
      platform: 'windows-x64',
      distribution,
      commit: taggedCommit,
      allowPublished: true
    })
  )
}
// Validate every channel before any production write.
const publications = await Promise.all(
  candidates.map(async (candidate) => ({
    candidate,
    channels: await prepareReleaseStoragePublication(candidate.verified.fragment)
  }))
)
const github = createGitHubReleasePublisher({ root: ROOT })
const githubRelease = await github.prepare(
  candidates.find((candidate) => candidate.state.distribution === 'international')
)
for (const { candidate, channels } of publications) {
  await publishReleaseStorage(candidate.verified, channels, {
    root: ROOT,
    run,
    awsExecutable: inspection.awsExecutable
  })
}
await github.publish(githubRelease)
for (const distribution of DISTRIBUTIONS)
  await markCandidatePublished({ tag: releaseTag, platform: 'windows-x64', distribution })
await cleanupLocalTestLogsSafely()
await cleanupLocalCandidates()
process.stdout.write(
  `[release] Windows ${releaseTag} published to Tencent COS, Cloudflare R2 and GitHub\n`
)
