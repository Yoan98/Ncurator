import { execFile, spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import {
  assertWindowsReleaseRouteAvailable,
  inspectLocalWindowsRelease
} from './shared/windows.mjs'
import {
  compareReleaseVersions,
  createReleaseTag,
  parseReleaseTag,
  RELEASE_VERSION_PATTERN
} from './tag.mjs'

const execFileAsync = promisify(execFile)
const ROOT = process.cwd()
const args = process.argv.slice(2)
const valueAfter = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const version = valueAfter('--version') || ''
const platform = valueAfter('--platform') || ''
const releaseTag =
  RELEASE_VERSION_PATTERN.test(version) && platform ? createReleaseTag(platform, version) : ''
const notes = valueAfter('--notes') || `Ncurator ${releaseTag}`
const forceLocal = args.includes('--local-only')
const forceActions = args.includes('--actions')
const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

if (!RELEASE_VERSION_PATTERN.test(version) || !['mac', 'windows'].includes(platform)) {
  throw new Error(
    'usage: node scripts/release/prepare.mjs --platform <mac|windows> --version <1.2.3> [--notes <text>] [--local-only|--actions]'
  )
}
if (forceLocal && forceActions) throw new Error('--local-only and --actions cannot be combined')
if (platform === 'mac' && (forceLocal || forceActions)) {
  throw new Error('mac release preparation cannot use Windows route options')
}

const run = (command, commandArgs) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
      shell: process.platform === 'win32' && /\.(cmd|bat)$/iu.test(command)
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with ${code ?? signal}`))
    })
  })

const branch = (
  await execFileAsync('git', ['branch', '--show-current'], { cwd: ROOT })
).stdout.trim()
if (branch !== 'main') throw new Error(`desktop releases must be prepared on main, not ${branch}`)

const { stdout: worktreeStatus } = await execFileAsync('git', ['status', '--porcelain'], {
  cwd: ROOT
})
if (worktreeStatus.trim()) throw new Error('desktop releases require a clean worktree')

await run('git', ['fetch', '--tags', 'origin', 'main'])
const [{ stdout: localHead }, { stdout: remoteHead }] = await Promise.all([
  execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }),
  execFileAsync('git', ['rev-parse', 'origin/main'], { cwd: ROOT })
])
if (localHead.trim() !== remoteHead.trim()) {
  throw new Error('local main must exactly match origin/main before preparing a release')
}

const packagePath = path.join(ROOT, 'package.json')
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'))
const { stdout: platformTagsOutput } = await execFileAsync(
  'git',
  ['tag', '--list', `${platform}-v*`],
  { cwd: ROOT }
)
const platformVersions = platformTagsOutput
  .split(/\r?\n/u)
  .filter(Boolean)
  .map((tag) => parseReleaseTag(tag, platform).version)
  .sort(compareReleaseVersions)
const latestPlatformVersion = platformVersions.at(-1)
if (latestPlatformVersion && compareReleaseVersions(version, latestPlatformVersion) <= 0) {
  throw new Error(`new ${platform} version ${version} must be higher than ${latestPlatformVersion}`)
}

const tagExists = await execFileAsync('git', ['rev-parse', '--verify', '--quiet', releaseTag], {
  cwd: ROOT
})
  .then(() => true)
  .catch(() => false)
if (tagExists) throw new Error(`tag already exists: ${releaseTag}`)

if (platform === 'windows') {
  const localInspection = forceActions ? undefined : await inspectLocalWindowsRelease(ROOT)
  await assertWindowsReleaseRouteAvailable({
    root: ROOT,
    forceLocal,
    forceActions,
    localInspection
  })
}

await run(pnpmExecutable, ['typecheck'])
await run(pnpmExecutable, ['test:update:backend'])
await run(pnpmExecutable, ['test:unit'])
await run(pnpmExecutable, ['test:ai:non-live'])

packageJson.version = version
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')
await run('git', ['add', '--', 'package.json'])
await run('git', ['commit', '-m', `release: prepare ${releaseTag}`])
await run('git', ['tag', '-a', releaseTag, '-m', notes])
await run('git', ['push', '--atomic', 'origin', 'main', releaseTag])

process.stdout.write(`[release] prepared and pushed ${releaseTag}\n`)

if (platform === 'mac') {
  process.stdout.write(`[release] ${releaseTag} prepared for independent macOS release\n`)
  process.exit(0)
}

const routeArgs = [
  path.join(ROOT, 'scripts', 'release', 'windows.mjs'),
  '--tag',
  releaseTag,
  '--prepare-only'
]
if (forceLocal) routeArgs.push('--local-only')
if (forceActions) routeArgs.push('--actions')
await run(process.execPath, routeArgs)
