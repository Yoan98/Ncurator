import { execFile, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { inspectLocalWindowsRelease } from './shared/windows.mjs'
import {
  compareReleaseVersions,
  createReleaseTag,
  parseReleaseTag,
  RELEASE_VERSION_PATTERN
} from './tag.mjs'
import { createReleaseStageDeadline } from './shared/stage-deadline.mjs'

const execFileAsync = promisify(execFile)
const ROOT = process.cwd()
const LIVE_KEY_ENV_NAMES = [
  'AI_LIVE_KEY_DASHSCOPE',
  'AI_LIVE_KEY_DEEPSEEK',
  'AI_LIVE_KEY_MIMO',
  'AI_LIVE_KEY_ZHIPU'
]
const PREFIX_CACHE_LIVE_CASE = 'prefix-cache-retain-live'
const args = process.argv.slice(2)
const valueAfter = (name) => {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

const VALUE_OPTIONS = new Set(['--platform', '--version', '--notes'])
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index]
  if (VALUE_OPTIONS.has(argument)) {
    const value = args[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`)
    index += 1
    continue
  }
  throw new Error(`unknown argument: ${argument}`)
}

const version = valueAfter('--version') || ''
const platform = valueAfter('--platform') || ''
const releaseTag =
  RELEASE_VERSION_PATTERN.test(version) && platform ? createReleaseTag(platform, version) : ''
const notes = valueAfter('--notes') || `Ncurator ${releaseTag}`
const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const stageDeadline = createReleaseStageDeadline('release preparation')

if (!RELEASE_VERSION_PATTERN.test(version) || !['mac', 'windows'].includes(platform)) {
  throw new Error(
    'usage: node scripts/release/prepare.mjs --platform <mac|windows> --version <1.2.3> [--notes <text>]'
  )
}

const loadRootEnv = () => {
  for (const fileName of ['.env.local', '.env']) {
    let raw = ''
    try {
      raw = readFileSync(path.resolve(ROOT, fileName), 'utf8')
    } catch {
      continue
    }
    for (const line of raw.split(/\r?\n/u)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const separator = trimmed.indexOf('=')
      if (separator <= 0) continue
      const key = trimmed.slice(0, separator).trim()
      const value = trimmed.slice(separator + 1).trim()
      if (!key || String(process.env[key] || '').trim()) continue
      const unquoted =
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
          ? value.slice(1, -1)
          : value
      process.env[key] = unquoted
    }
  }
}

const assertReleaseLiveKeyConfigured = () => {
  loadRootEnv()
  const provider = String(process.env.AI_LIVE_PROVIDER || 'dashscope')
    .trim()
    .toLowerCase()
  const preferredKey = `AI_LIVE_KEY_${provider.toUpperCase()}`
  if (String(process.env[preferredKey] || '').trim()) return
  const anyKey = LIVE_KEY_ENV_NAMES.find((name) => String(process.env[name] || '').trim())
  if (anyKey) {
    throw new Error(
      `发布准备必跑 ${PREFIX_CACHE_LIVE_CASE}：已配置 ${anyKey}，但 AI_LIVE_PROVIDER=${provider} 缺少 ${preferredKey}`
    )
  }
  throw new Error(
    `发布准备必跑 ${PREFIX_CACHE_LIVE_CASE}：请在 .env 配置 ${preferredKey}（或设置 AI_LIVE_PROVIDER 并提供对应 AI_LIVE_KEY_*）`
  )
}

const run = (command, commandArgs) =>
  new Promise((resolve, reject) => {
    const child = stageDeadline.track(
      spawn(command, commandArgs, {
        cwd: ROOT,
        env: process.env,
        stdio: 'inherit',
        shell: process.platform === 'win32' && /\.(cmd|bat)$/iu.test(command)
      })
    )
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
  throw new Error(
    `new ${platform} version ${version} must be higher than ${latestPlatformVersion}; abort an unpublished tag with pnpm release:abort -- --tag ${platform}-v${latestPlatformVersion} before reusing a version`
  )
}

const tagExists = await execFileAsync('git', ['rev-parse', '--verify', '--quiet', releaseTag], {
  cwd: ROOT
})
  .then(() => true)
  .catch(() => false)
if (tagExists) {
  throw new Error(
    `tag already exists: ${releaseTag}; abort it with pnpm release:abort -- --tag ${releaseTag} if it was never published live`
  )
}

if (platform === 'windows') {
  const localInspection = await inspectLocalWindowsRelease(ROOT)
  if (!localInspection.ready) {
    throw new Error(
      `local Windows release is unavailable:\n- ${localInspection.issues.join('\n- ')}`
    )
  }
}

const sqliteMigrationLockScript = path.join(
  ROOT,
  'scripts',
  'release',
  'shared',
  'sqlite-migration-lock.mjs'
)
await run(process.execPath, [sqliteMigrationLockScript])

await Promise.all([
  run(pnpmExecutable, ['typecheck:node']),
  run(pnpmExecutable, ['typecheck:web']),
  run(process.execPath, [path.join(ROOT, 'scripts', 'build', 'sidecar', 'ensure.mjs')])
])
await run(process.execPath, [
  path.join(ROOT, 'scripts', 'test', 'workflow.mjs'),
  '--type',
  'backend',
  '--exclude-group',
  'live'
])

process.env.NCURATOR_RELEASE_PREPARE = '1'
assertReleaseLiveKeyConfigured()
process.stdout.write(`[release] running required live gate: ${PREFIX_CACHE_LIVE_CASE}\n`)
await run(process.execPath, [
  path.join(ROOT, 'scripts', 'test', 'workflow.mjs'),
  '--type',
  'e2e',
  '--domain',
  'workbench',
  '--suite',
  'conversation',
  '--group',
  'prefix-cache',
  '--case',
  PREFIX_CACHE_LIVE_CASE,
  '--target',
  'source'
])

await run(process.execPath, [sqliteMigrationLockScript, '--promote-current'])

packageJson.version = version
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')
await run('git', [
  'add',
  '--',
  'package.json',
  'src/main/services/storage/sqlite/migrations/released-migrations.json'
])
await run('git', ['commit', '--allow-empty', '-m', `release: prepare ${releaseTag}`])
await run('git', ['tag', '-a', releaseTag, '-m', notes])
await run('git', ['push', '--atomic', 'origin', 'main', releaseTag])

process.stdout.write(`[release] prepared and pushed ${releaseTag}\n`)

if (platform === 'mac') {
  process.stdout.write(`[release] ${releaseTag} prepared for independent macOS release\n`)
  process.exit(0)
}

await run(process.execPath, [
  path.join(ROOT, 'scripts', 'release', 'windows.mjs'),
  '--tag',
  releaseTag,
  '--prepare-only'
])
