import { execFile, spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { createReleaseBundle } from './artifact-bundle.mjs'
import {
  assertCandidatePublishable,
  markCandidatePublished,
  materializeReleaseCandidate,
  readReleaseCandidate,
  recordCandidateE2E
} from './candidate.mjs'
import {
  assertWindowsReleaseRouteAvailable,
  dispatchWindowsRelease,
  inspectLocalWindowsRelease,
  readPublicReleaseFragment,
  verifyPublicReleaseFragment,
  verifyR2ReleaseFragment
} from './shared/windows.mjs'
import { prepareReleaseWorkspace } from './workspace.mjs'

const execFileAsync = promisify(execFile)
const ROOT = process.cwd()
const args = process.argv.slice(2)
const valueAfter = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const releaseTag = valueAfter('--tag') || ''
const forceLocal = args.includes('--local-only')
const forceActions = args.includes('--actions')
const packageE2E = args.includes('--package-e2e')
const candidateRunId = valueAfter('--candidate-run-id') || ''
const modes = [
  ['prepare', args.includes('--prepare-only')],
  ['test', args.includes('--test-only')],
  ['publish', args.includes('--publish-only')]
].filter(([, enabled]) => enabled)

if (!/^v\d+\.\d+\.\d+$/u.test(releaseTag) || modes.length !== 1) {
  throw new Error(
    'usage: node scripts/release/windows.mjs --tag <v1.2.3> (--prepare-only|--test-only|--publish-only) [--package-e2e] [--local-only|--actions] [--candidate-run-id <id>]'
  )
}
if (forceLocal && forceActions) throw new Error('--local-only and --actions cannot be combined')
const mode = modes[0][0]
if (mode !== 'prepare' && packageE2E) {
  throw new Error('--package-e2e can only be combined with --prepare-only')
}
if (mode === 'test' && forceActions)
  throw new Error('--test-only currently requires the local route')
if (candidateRunId && !(mode === 'publish' && forceActions)) {
  throw new Error('--candidate-run-id is only valid for Actions publish-only')
}

const run = (command, commandArgs, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
      shell: process.platform === 'win32' && /\.(cmd|bat)$/iu.test(command),
      ...options
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with ${code ?? signal}`))
    })
  })

const requirePublish = mode === 'publish'
const localInspection = forceActions
  ? undefined
  : await inspectLocalWindowsRelease(ROOT, { requirePublish })
const route = await assertWindowsReleaseRouteAvailable({
  root: ROOT,
  forceLocal: forceLocal || mode === 'test',
  forceActions,
  localInspection
})
if (route === 'actions') {
  await dispatchWindowsRelease(ROOT, releaseTag, {
    mode,
    packageE2E,
    candidateRunId
  })
  process.exit(0)
}
const inspection = localInspection

const { stdout: tagType } = await execFileAsync('git', ['cat-file', '-t', releaseTag], {
  cwd: ROOT
})
if (tagType.trim() !== 'tag') throw new Error(`${releaseTag} must be an annotated tag`)
const { stdout: taggedPackageJson } = await execFileAsync('git', [
  'show',
  `${releaseTag}:package.json`
])
const taggedVersion = JSON.parse(taggedPackageJson).version
if (releaseTag !== `v${taggedVersion}`) {
  throw new Error(`${releaseTag} does not match package version ${taggedVersion}`)
}
const { stdout: taggedCommitOutput } = await execFileAsync('git', [
  'rev-list',
  '-n',
  '1',
  releaseTag
])
const taggedCommit = taggedCommitOutput.trim()

const releaseEnvironment = () => {
  const environment = {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY:
      String(process.env.CSC_IDENTITY_AUTO_DISCOVERY || '').trim() || 'false',
    NCURATOR_SIDECAR_BROWSER_CACHE:
      String(process.env.NCURATOR_SIDECAR_BROWSER_CACHE || '').trim() ||
      path.join(os.homedir(), '.ncurator', 'release-tools', 'sidecar-browser-cache', 'win32-x64'),
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
    'R2_PUBLIC_BASE_URL'
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
  const archivePath = path.join(workspace.workDirectory, 'source.zip')
  const sourceDirectory = path.join(workspace.workDirectory, 'source')
  await run('git', ['archive', '--format=zip', '--output', archivePath, releaseTag])
  await mkdir(sourceDirectory, { recursive: true })
  await run('tar', ['-xf', archivePath, '-C', sourceDirectory])
  return { workspace, sourceDirectory }
}

const runCandidateE2E = async ({ candidate, sourceDirectory, environment }) => {
  const resultPath = path.join(candidate.directory, 'package-e2e-result.json')
  try {
    await run(
      inspection.pnpmExecutable,
      ['run', 'test:e2e:package', '--', '--bundle', candidate.bundlePath, '--result', resultPath],
      { cwd: sourceDirectory, env: testEnvironment(environment) }
    )
    return await recordCandidateE2E({
      tag: releaseTag,
      platform: 'windows-x64',
      status: 'passed',
      resultPath
    })
  } catch (error) {
    await recordCandidateE2E({
      tag: releaseTag,
      platform: 'windows-x64',
      status: 'failed',
      resultPath
    })
    throw error
  }
}

if (mode === 'prepare') {
  const { workspace, sourceDirectory } = await extractTagSource('ncurator-release-prepare')
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
    let candidate = await materializeReleaseCandidate({ bundlePath })
    if (packageE2E) {
      candidate = await runCandidateE2E({ candidate, sourceDirectory, environment })
    } else {
      candidate = await recordCandidateE2E({
        tag: releaseTag,
        platform: 'windows-x64',
        status: 'skipped'
      })
    }
    process.stdout.write(
      `[release] candidate ready; R2 publish paused\n[release] bundle ${candidate.bundlePath}\n`
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
  const { workspace, sourceDirectory } = await extractTagSource('ncurator-release-test')
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

const publicBaseUrl = String(process.env.R2_PUBLIC_BASE_URL).replace(/\/$/u, '')
const existing = await readPublicReleaseFragment(releaseTag, 'windows-x64', publicBaseUrl)
if (existing) {
  await verifyPublicReleaseFragment(existing, publicBaseUrl)
  await verifyR2ReleaseFragment(existing, inspection.awsExecutable)
  process.stdout.write(`[release] Windows ${releaseTag} is already complete on R2\n`)
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
await verifyR2ReleaseFragment(candidate.verified.fragment, inspection.awsExecutable)
await markCandidatePublished({ tag: releaseTag, platform: 'windows-x64' })
process.stdout.write(`[release] Windows ${releaseTag} published from ${candidate.bundlePath}\n`)
