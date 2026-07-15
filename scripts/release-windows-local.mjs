/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { execFile, spawn } from 'node:child_process'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import {
  inspectLocalWindowsRelease,
  readPublicReleaseFragment,
  verifyPublicReleaseFragment,
  verifyR2ReleaseFragment
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
const reuseWork = args.includes('--reuse-work')

if (!/^v\d+\.\d+\.\d+$/u.test(releaseTag)) {
  throw new Error(
    'usage: node scripts/release-windows-local.mjs --tag <v1.2.3> [--keep-work] [--reuse-work]'
  )
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

const pathExists = (filePath) =>
  access(filePath)
    .then(() => true)
    .catch(() => false)

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
  await verifyR2ReleaseFragment(existing, inspection.awsExecutable)
  process.stdout.write(
    `[release] Windows ${releaseTag} is already complete on R2; skipped rebuild\n`
  )
  process.exit(0)
}

const workRoot = path.resolve(
  String(process.env.NCURATOR_RELEASE_WORK_ROOT || '').trim() ||
    path.join(os.tmpdir(), 'ncurator-release')
)
const workDirectory = path.join(workRoot, releaseTag)
const archivePath = path.join(workDirectory, 'source.zip')
const sourceDirectory = path.join(workDirectory, 'source')
const cacheDirectory = path.join(workDirectory, 'reusable-cache')
const tagCommitPath = path.join(workDirectory, 'tag-commit.txt')
const { stdout: tagCommitOutput } = await execFileAsync('git', ['rev-list', '-n', '1', releaseTag])
const tagCommit = tagCommitOutput.trim()

const reusablePaths = ['.runvenv', '.pip-cache', 'resources/web_crawler_sidecar/bin']
const preserveReusableCache = async () => {
  if (!(await pathExists(sourceDirectory))) return
  for (const relativePath of reusablePaths) {
    const source = path.join(sourceDirectory, relativePath)
    if (!(await pathExists(source))) continue
    const target = path.join(cacheDirectory, relativePath)
    await mkdir(path.dirname(target), { recursive: true })
    await rm(target, { recursive: true, force: true })
    await rename(source, target)
  }
}

const restoreReusableCache = async () => {
  if (!(await pathExists(cacheDirectory))) return
  for (const relativePath of reusablePaths) {
    const source = path.join(cacheDirectory, relativePath)
    if (!(await pathExists(source))) continue
    const target = path.join(sourceDirectory, relativePath)
    await mkdir(path.dirname(target), { recursive: true })
    await rm(target, { recursive: true, force: true })
    await rename(source, target)
  }
  await rm(cacheDirectory, { recursive: true, force: true })
}

let completed = false

try {
  if (reuseWork) {
    const cachedCommit = await readFile(tagCommitPath, 'utf8').catch(() => '')
    if (cachedCommit.trim() !== tagCommit) {
      throw new Error(`reusable Windows release work does not match immutable tag ${releaseTag}`)
    }
    await preserveReusableCache()
    process.stdout.write(`[release] reusing Windows work directory ${workDirectory}\n`)
  } else {
    await rm(workDirectory, { recursive: true, force: true })
  }
  await rm(sourceDirectory, { recursive: true, force: true })
  await rm(archivePath, { force: true })
  await mkdir(sourceDirectory, { recursive: true })
  await run('git', ['archive', '--format=zip', '--output', archivePath, releaseTag])
  await run('tar', ['-xf', archivePath, '-C', sourceDirectory])
  if (reuseWork) await restoreReusableCache()
  await writeFile(tagCommitPath, `${tagCommit}\n`, 'utf8')

  const releaseEnvironment = {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY:
      String(process.env.CSC_IDENTITY_AUTO_DISCOVERY || '').trim() || 'false',
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
  await verifyR2ReleaseFragment(fragment, inspection.awsExecutable)
  completed = true
  process.stdout.write(`[release] Windows ${releaseTag} uploaded and verified\n`)
} finally {
  if (keepWork || !completed) {
    process.stdout.write(`[release] kept work directory ${workDirectory}\n`)
    if (!completed) {
      process.stdout.write(
        `[release] retry with: pnpm release:win -- --tag ${releaseTag} --reuse-work\n`
      )
    }
  } else await rm(workDirectory, { recursive: true, force: true })
}
