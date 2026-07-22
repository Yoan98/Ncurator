import { execFile, spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import {
  assertWindowsReleaseRouteAvailable,
  dispatchWindowsRelease,
  inspectLocalWindowsRelease,
  readPublicReleaseFragment,
  verifyPublicReleaseFragment,
  verifyR2ReleaseFragment
} from './shared/windows.mjs'
import { prepareReleaseWorkspace } from './workspace.mjs'
import { createReleaseBundle, verifyReleaseBundle } from './artifact-bundle.mjs'

const execFileAsync = promisify(execFile)
const ROOT = process.cwd()
const args = process.argv.slice(2)
const valueAfter = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const releaseTag = valueAfter('--tag') || ''
const keepWork = args.includes('--keep-work')
const forceLocal = args.includes('--local-only')
const forceActions = args.includes('--actions')
const packageE2E = args.includes('--package-e2e')

if (!/^v\d+\.\d+\.\d+$/u.test(releaseTag)) {
  throw new Error(
    'usage: node scripts/release/windows.mjs --tag <v1.2.3> [--local-only|--actions] [--package-e2e] [--keep-work]'
  )
}
if (forceLocal && forceActions) throw new Error('--local-only and --actions cannot be combined')

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

const localInspection = forceActions ? undefined : await inspectLocalWindowsRelease(ROOT)
const route = await assertWindowsReleaseRouteAvailable({
  root: ROOT,
  forceLocal,
  forceActions,
  localInspection
})
if (route === 'actions') {
  if (localInspection?.issues.length) {
    process.stdout.write(
      `[release] local Windows release unavailable; using Actions:\n- ${localInspection.issues.join('\n- ')}\n`
    )
  }
  await dispatchWindowsRelease(ROOT, releaseTag, { packageE2E })
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

const publicBaseUrl = String(process.env.R2_PUBLIC_BASE_URL).replace(/\/$/u, '')
const existing = await readPublicReleaseFragment(releaseTag, 'windows-x64', publicBaseUrl)
if (existing) {
  await verifyPublicReleaseFragment(existing, publicBaseUrl)
  await verifyR2ReleaseFragment(existing, inspection.awsExecutable)
  process.stdout.write(
    `[release] Windows ${releaseTag} is already complete on R2; skipped rebuild\n`
  )
  process.exit(0)
}

const releaseWorkspace = await prepareReleaseWorkspace({
  releaseTag,
  defaultRootName: 'ncurator-release',
  keepWork
})
const { workDirectory } = releaseWorkspace
const archivePath = path.join(workDirectory, 'source.zip')
const sourceDirectory = path.join(workDirectory, 'source')

try {
  await run('git', ['archive', '--format=zip', '--output', archivePath, releaseTag])
  await mkdir(sourceDirectory, { recursive: true })
  await run('tar', ['-xf', archivePath, '-C', sourceDirectory])

  const releaseEnvironment = {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY:
      String(process.env.CSC_IDENTITY_AUTO_DISCOVERY || '').trim() || 'false',
    NCURATOR_SIDECAR_BROWSER_CACHE:
      String(process.env.NCURATOR_SIDECAR_BROWSER_CACHE || '').trim() ||
      path.join(os.homedir(), '.ncurator', 'release-tools', 'sidecar-browser-cache', 'win32-x64'),
    NCURATOR_SIDECAR_BUILD_PYTHON:
      String(process.env.NCURATOR_SIDECAR_BUILD_PYTHON || '').trim() || inspection.python.executable
  }
  delete releaseEnvironment.CSC_LINK
  delete releaseEnvironment.CSC_KEY_PASSWORD
  delete releaseEnvironment.WIN_CSC_LINK
  delete releaseEnvironment.WIN_CSC_KEY_PASSWORD
  process.stdout.write(`[release] building ${releaseTag} for Windows x64\n`)
  await run(inspection.pnpmExecutable, ['install', '--frozen-lockfile'], {
    cwd: sourceDirectory,
    env: releaseEnvironment
  })
  await run(inspection.pnpmExecutable, ['run', 'build:win'], {
    cwd: sourceDirectory,
    env: releaseEnvironment
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
    { cwd: sourceDirectory, env: releaseEnvironment }
  )
  const bundlePath = path.join(distDirectory, 'release-bundle-windows-x64.json')
  await createReleaseBundle({ fragmentPath, outputPath: bundlePath, commit: taggedCommit })

  if (packageE2E) {
    const testEnvironment = { ...releaseEnvironment }
    for (const name of [
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'R2_ACCOUNT_ID',
      'R2_BUCKET_NAME',
      'R2_PUBLIC_BASE_URL'
    ]) {
      delete testEnvironment[name]
    }
    process.stdout.write(`[release] running package E2E for ${releaseTag} Windows x64\n`)
    await run(
      inspection.pnpmExecutable,
      ['run', 'test:e2e:package', '--', '--bundle', bundlePath],
      { cwd: sourceDirectory, env: testEnvironment }
    )
  } else {
    process.stdout.write('[release] package E2E: skipped by release policy\n')
  }

  await verifyReleaseBundle(bundlePath, { tag: releaseTag, platform: 'windows-x64' })
  await run(
    process.execPath,
    [
      path.join(sourceDirectory, 'scripts', 'release', 'r2', 'upload-fragment.mjs'),
      distDirectory,
      fragmentPath
    ],
    { cwd: sourceDirectory, env: releaseEnvironment }
  )
  await run(
    process.execPath,
    [
      path.join(sourceDirectory, 'scripts', 'release', 'r2', 'finalize-windows.mjs'),
      '--tag',
      releaseTag
    ],
    { cwd: sourceDirectory, env: releaseEnvironment }
  )

  const fragment = JSON.parse(await readFile(fragmentPath, 'utf8'))
  await verifyPublicReleaseFragment(fragment, publicBaseUrl)
  await verifyR2ReleaseFragment(fragment, inspection.awsExecutable)
  process.stdout.write(`[release] Windows ${releaseTag} published and verified\n`)
} finally {
  await releaseWorkspace.dispose()
}
