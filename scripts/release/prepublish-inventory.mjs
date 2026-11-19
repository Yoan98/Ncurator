import { execFileSync } from 'node:child_process'
import { createGitHubReleasePublisher } from './github.mjs'
import { readReleaseCandidate } from './candidate.mjs'
import { listSupersededReleaseKeys } from './r2/cleanup-inventory.mjs'
import { DISTRIBUTIONS, distributionStorage } from './shared/distribution.mjs'
import { createReleaseStorageLister } from './storage/client.mjs'
import { prepareReleaseStoragePublication } from './storage/publish.mjs'
import { parseReleaseTag } from './tag.mjs'

const [option, tag, ...extra] = process.argv.slice(2)
if (option !== '--tag' || !tag || extra.length) {
  throw new Error(
    'usage: node scripts/release/prepublish-inventory.mjs --tag <mac-v1.2.3|windows-v1.2.3>'
  )
}
const { family } = parseReleaseTag(tag)
const platform = family === 'mac' ? 'macos-arm64' : 'windows-x64'
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', timeout: 10_000 }).trim()
if (git('cat-file', '-t', 'refs/tags/' + tag) !== 'tag')
  throw new Error('expected annotated release tag')
const commit = git('rev-parse', 'refs/tags/' + tag + '^{commit}')
for (const distribution of DISTRIBUTIONS) {
  const { state, verified } = await readReleaseCandidate({ tag, platform, distribution })
  if (state.commit !== commit) throw new Error('candidate commit does not match release tag')
  if (distribution === 'international') {
    await createGitHubReleasePublisher({ root: process.cwd() }).verifyCandidateSource(
      verified.bundle
    )
  }
  const target = distributionStorage(distribution)
  const storage = await createReleaseStorageLister(process.cwd(), { target })
  const channels = await prepareReleaseStoragePublication(verified.fragment)
  const channel = channels.find(({ config }) => config.target === target)
  if (!channel) throw new Error('release channel does not match candidate distribution')
  const keys = channel.current
    ? []
    : await listSupersededReleaseKeys(verified.fragment, storage.listKeys)
  process.stdout.write(
    JSON.stringify({
      tag,
      distribution,
      target,
      current: channel.current,
      candidateStatus: state.status,
      cleanupKeys: keys
    }) + '\n'
  )
}
