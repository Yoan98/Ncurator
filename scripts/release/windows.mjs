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
import {
  inspectLocalWindowsRelease,
  readPublicReleaseFragment,
  verifyPublicReleaseFragment,
  verifyReleaseStorageFragment
} from './shared/windows.mjs'
import { assertLivePublishAllowed, resolveReleaseStorageConfig } from './storage/config.mjs'
import { prepareReleaseWorkspace } from './workspace.mjs'
import { parseReleaseTag } from './tag.mjs'
import { hasRegressionSelectionArgs, readRegressionSelection } from './regression.mjs'
import { cleanupLocalTestLogs } from './shared/test-logs.mjs'
import { createReleaseStageDeadline } from './shared/stage-deadline.mjs'

const execFileAsync = promisify(execFile)
const ROOT = process.cwd()
const stageDeadline = createReleaseStageDeadline('Windows release stage')
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

let releaseVersion = ''
try {
  releaseVersion = parseReleaseTag(releaseTag, 'windows').version
} catch {
  // Report the complete command contract below.
}
if (!releaseVersion || modes.length !== 1) {
  throw new Error(
    'usage: node scripts/release/windows.mjs --tag <windows-v1.2.3> (--prepare-only|--test-only|--publish-only) [--domain <name>] [--suite <name>] [--group <name>] [--case <caseId>] [--fresh-knowledge-cache]'
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
        path.join(sourceDirectory, 'scripts', 'test', 'workflow.mjs'),
        '--type',
        'e2e',
        '--target',
        'package',
        '--exclude-group',
        'provider-matrix',
        '--bundle',
        candidate.bundlePath,
        '--result',
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
    const distDirectory = path.join(sourceDirectory, 'dist')
    const fragmentPath = path.join(distDirectory, 'windows-x64.json')
    await run(
      process.execPath,
      [
        path.join(sourceDirectory, 'scripts', 'release', 'r2', 'create-fragment.mjs'),
        distDirectory,
        fragmentPath,
        releaseTag,
        'windows-x64'
      ],
      { cwd: sourceDirectory, env: environment }
    )
    const bundlePath = path.join(distDirectory, 'release-bundle-windows-x64.json')
    await createReleaseBundle({ fragmentPath, outputPath: bundlePath, commit: taggedCommit })
    const candidate = await materializeReleaseCandidate({ bundlePath })
    process.stdout.write(
      `[release] candidate prepared; impact assessment and package E2E are required before publish\n[release] bundle ${candidate.bundlePath}\n`
    )
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
    candidate = await runCandidateE2E({ candidate, sourceDirectory, environment })
    process.stdout.write(`[release] candidate E2E passed: ${candidate.bundlePath}\n`)
  } finally {
    await workspace.dispose()
  }
  process.exit(0)
}

const storage = resolveReleaseStorageConfig()
const publicBaseUrl = storage.publicBaseUrl
const existing = await readPublicReleaseFragment(releaseTag, 'windows-x64', publicBaseUrl)
if (existing) {
  await verifyPublicReleaseFragment(existing, publicBaseUrl)
  await verifyReleaseStorageFragment(existing, inspection.awsExecutable)
  await cleanupLocalTestLogsSafely()
  await cleanupLocalCandidates()
  process.stdout.write(`[release] Windows ${releaseTag} is already complete on ${storage.label}\n`)
  process.exit(0)
}
const candidate = await assertCandidatePublishable({
  tag: releaseTag,
  platform: 'windows-x64',
  commit: taggedCommit
})
await run(
  process.execPath,
  [
    path.join(ROOT, 'scripts', 'release', 'r2', 'upload-fragment.mjs'),
    candidate.verified.directory,
    candidate.verified.fragmentPath
  ],
  { cwd: ROOT, env: process.env }
)
await run(
  process.execPath,
  [path.join(ROOT, 'scripts', 'release', 'r2', 'finalize-windows.mjs'), '--tag', releaseTag],
  { cwd: ROOT, env: process.env }
)
await verifyPublicReleaseFragment(candidate.verified.fragment, publicBaseUrl)
await verifyReleaseStorageFragment(candidate.verified.fragment, inspection.awsExecutable)
await markCandidatePublished({ tag: releaseTag, platform: 'windows-x64' })
await cleanupLocalTestLogsSafely()
await cleanupLocalCandidates()
process.stdout.write(`[release] Windows ${releaseTag} published from ${candidate.bundlePath}\n`)
