/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { execFile, spawn } from 'node:child_process'
import { mkdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import {
  inspectLocalWindowsRelease,
  readPublicReleaseFragment,
  verifyPublicReleaseFragment
} from './windows-release-common.mjs'

const execFileAsync = promisify(execFile)
const ROOT = process.cwd()
const args = process.argv.slice(2)
const valueAfter = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const releaseTag = valueAfter('--tag') || ''
const keepWork = args.includes('--keep-work')

if (!/^v\d+\.\d+\.\d+$/u.test(releaseTag)) {
  throw new Error('usage: node scripts/release-windows-local.mjs --tag <v1.2.3> [--keep-work]')
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

const inspection = await inspectLocalWindowsRelease(ROOT)
if (!inspection.ready) {
  throw new Error(`local Windows release preflight failed:\n- ${inspection.issues.join('\n- ')}`)
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
if (releaseTag !== `v${taggedVersion}`) {
  throw new Error(`${releaseTag} does not match package version ${taggedVersion}`)
}

const publicBaseUrl = String(process.env.R2_PUBLIC_BASE_URL).replace(/\/$/u, '')
const existing = await readPublicReleaseFragment(releaseTag, 'windows-x64', publicBaseUrl)
if (existing) {
  await verifyPublicReleaseFragment(existing, publicBaseUrl)
  process.stdout.write(
    `[release] Windows ${releaseTag} is already complete on R2; skipped rebuild\n`
  )
  process.exit(0)
}

const workDirectory = path.join(os.tmpdir(), `ncw-${releaseTag}`)
const archivePath = path.join(workDirectory, 'source.zip')
const sourceDirectory = path.join(workDirectory, 'source')

await rm(workDirectory, { recursive: true, force: true })
await mkdir(sourceDirectory, { recursive: true })

try {
  await run('git', ['archive', '--format=zip', '--output', archivePath, releaseTag])
  await run('tar', ['-xf', archivePath, '-C', sourceDirectory])

  const releaseEnvironment = {
    ...process.env,
    NCURATOR_SIDECAR_BROWSER_CACHE:
      String(process.env.NCURATOR_SIDECAR_BROWSER_CACHE || '').trim() ||
      path.join(os.homedir(), '.ncurator', 'release-tools', 'sidecar-browser-cache', 'win32-x64')
  }
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
      path.join(sourceDirectory, 'scripts', 'create-release-fragment.mjs'),
      distDirectory,
      fragmentPath,
      releaseTag,
      'windows-x64'
    ],
    { cwd: sourceDirectory, env: releaseEnvironment }
  )
  await run(
    process.execPath,
    [
      path.join(sourceDirectory, 'scripts', 'upload-r2-release-fragment.mjs'),
      distDirectory,
      fragmentPath
    ],
    { cwd: sourceDirectory, env: releaseEnvironment }
  )

  const fragment = JSON.parse(await readFile(fragmentPath, 'utf8'))
  await verifyPublicReleaseFragment(fragment, publicBaseUrl)
  process.stdout.write(`[release] Windows ${releaseTag} uploaded and verified\n`)
} finally {
  if (keepWork) process.stdout.write(`[release] kept work directory ${workDirectory}\n`)
  else await rm(workDirectory, { recursive: true, force: true })
}
