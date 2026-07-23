import { execFile, spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import {
  assertWindowsReleaseRouteAvailable,
  inspectLocalWindowsRelease
} from './shared/windows.mjs'

const execFileAsync = promisify(execFile)
const ROOT = process.cwd()
const args = process.argv.slice(2)
const valueAfter = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const version = valueAfter('--version') || ''
const releaseTag = `v${version}`
const notes = valueAfter('--notes') || `Ncurator ${releaseTag}`
const forceLocal = args.includes('--local-only')
const forceActions = args.includes('--actions')
const macOnly = args.includes('--mac-only')
const packageE2E = args.includes('--package-e2e')
const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

if (!/^\d+\.\d+\.\d+$/u.test(version)) {
  throw new Error(
    'usage: node scripts/release/prepare.mjs --version <1.2.3> [--notes <text>] [--local-only|--actions|--mac-only] [--package-e2e]'
  )
}
if (forceLocal && forceActions) throw new Error('--local-only and --actions cannot be combined')
if (macOnly && (forceLocal || forceActions || packageE2E)) {
  throw new Error('--mac-only cannot be combined with Windows route or package E2E options')
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

const compareVersions = (left, right) => {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return 0
}

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
if (compareVersions(version, packageJson.version) <= 0) {
  throw new Error(`new version ${version} must be higher than ${packageJson.version}`)
}

const tagExists = await execFileAsync('git', ['rev-parse', '--verify', '--quiet', releaseTag], {
  cwd: ROOT
})
  .then(() => true)
  .catch(() => false)
if (tagExists) throw new Error(`tag already exists: ${releaseTag}`)

if (!macOnly) {
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

packageJson.version = version
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')
await run('git', ['add', '--', 'package.json'])
await run('git', ['commit', '-m', `release: prepare ${releaseTag}`])
await run('git', ['tag', '-a', releaseTag, '-m', notes])
await run('git', ['push', '--atomic', 'origin', 'main', releaseTag])

process.stdout.write(`[release] prepared and pushed ${releaseTag}\n`)

if (macOnly) {
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
if (packageE2E) routeArgs.push('--package-e2e')
await run(process.execPath, routeArgs)
