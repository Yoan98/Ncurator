import { execFile } from 'node:child_process'
import { access, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { resolveCandidateDirectory } from './candidate.mjs'
import { findLiveChannelsForTag } from './shared/live-tag.mjs'
import { parseReleaseTag } from './tag.mjs'

const execFileAsync = promisify(execFile)
const ROOT = process.cwd()
const ABORT_TOKEN = 'abort-unpublished-tag'
const args = process.argv.slice(2)
const valueAfter = (name) => {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

for (let index = 0; index < args.length; index += 1) {
  const argument = args[index]
  if (argument !== '--tag') throw new Error(`unknown argument: ${argument}`)
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error('--tag requires a value')
  index += 1
}

const releaseTag = valueAfter('--tag') || ''
let family = ''
let version = ''
try {
  ;({ family, version } = parseReleaseTag(releaseTag))
} catch {
  throw new Error('usage: node scripts/release/abort.mjs --tag <mac-vX.Y.Z|windows-vX.Y.Z>')
}

if (process.env.NCURATOR_ALLOW_ABORT_TAG !== ABORT_TOKEN) {
  throw new Error(
    `aborting an unpublished release tag requires NCURATOR_ALLOW_ABORT_TAG=${ABORT_TOKEN}`
  )
}

const branch = (
  await execFileAsync('git', ['branch', '--show-current'], { cwd: ROOT })
).stdout.trim()
if (branch !== 'main') throw new Error(`release abort must run on main, not ${branch}`)

const { stdout: worktreeStatus } = await execFileAsync('git', ['status', '--porcelain'], {
  cwd: ROOT
})
if (worktreeStatus.trim()) throw new Error('release abort requires a clean worktree')

await execFileAsync('git', ['fetch', '--tags', 'origin', 'main'], { cwd: ROOT })

const liveChannels = await findLiveChannelsForTag(releaseTag)
if (liveChannels.length > 0) {
  throw new Error(
    `${releaseTag} is live on ${liveChannels.join(', ')}; published tags cannot be aborted`
  )
}

const platforms = family === 'mac' ? ['macos-arm64'] : ['windows-x64']
for (const platform of platforms) {
  const directory = resolveCandidateDirectory(releaseTag, platform)
  const statePath = path.join(directory, 'candidate-state.json')
  const exists = await access(statePath)
    .then(() => true)
    .catch((error) => {
      if (error?.code === 'ENOENT') return false
      throw error
    })
  if (!exists) continue
  const state = JSON.parse(await readFile(statePath, 'utf8'))
  if (state?.status === 'published') {
    throw new Error(
      `local candidate ${releaseTag} ${platform} is marked published; refuse to abort`
    )
  }
}

const remoteTags = (
  await execFileAsync('git', ['ls-remote', '--tags', 'origin', releaseTag], { cwd: ROOT })
).stdout
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter(Boolean)
const remoteExists = remoteTags.some((line) => line.endsWith(`refs/tags/${releaseTag}`))

const localExists = await execFileAsync('git', ['rev-parse', '--verify', '--quiet', releaseTag], {
  cwd: ROOT
})
  .then(() => true)
  .catch(() => false)

if (!remoteExists && !localExists) {
  throw new Error(`tag not found locally or on origin: ${releaseTag}`)
}

if (remoteExists) {
  await execFileAsync('git', ['push', 'origin', `:refs/tags/${releaseTag}`], { cwd: ROOT })
  process.stdout.write(`[release] deleted origin tag ${releaseTag}\n`)
}

if (localExists) {
  await execFileAsync('git', ['tag', '-d', releaseTag], { cwd: ROOT })
  process.stdout.write(`[release] deleted local tag ${releaseTag}\n`)
}

const tagCandidateRoot = path.dirname(resolveCandidateDirectory(releaseTag, platforms[0]))
await rm(tagCandidateRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })

process.stdout.write(
  `[release] aborted unpublished ${releaseTag}; re-run: pnpm release:start -- --platform ${family} --version ${version}\n`
)
process.stdout.write(
  '[release] prepare commits on main are kept; only the tag and local candidates are removed\n'
)
