import process from 'node:process'
import { loadReleaseEnvironment } from './release-environment.mjs'
import {
  PUBLIC_RELEASE_BASE_URL,
  readPublicReleaseFragment,
  verifyPublicReleaseFragment
} from './windows-release-common.mjs'

const ROOT = process.cwd()
await loadReleaseEnvironment(ROOT)
const args = process.argv.slice(2)
const tagIndex = args.indexOf('--tag')
const releaseTag = tagIndex >= 0 ? args[tagIndex + 1] || '' : ''
if (!/^v\d+\.\d+\.\d+$/u.test(releaseTag)) {
  throw new Error('usage: node scripts/release-status.mjs --tag <v1.2.3>')
}

const publicBaseUrl = String(process.env.R2_PUBLIC_BASE_URL || PUBLIC_RELEASE_BASE_URL).replace(
  /\/$/u,
  ''
)
const platforms = ['windows-x64', 'macos-arm64', 'macos-x64']
for (const platform of platforms) {
  const fragment = await readPublicReleaseFragment(releaseTag, platform, publicBaseUrl)
  if (!fragment) {
    process.stdout.write(`${platform.padEnd(14)} missing\n`)
    continue
  }
  await verifyPublicReleaseFragment(fragment, publicBaseUrl)
  process.stdout.write(`${platform.padEnd(14)} ready\n`)
}

const latestResponse = await fetch(`${publicBaseUrl}/releases/latest.json?check=${Date.now()}`, {
  cache: 'no-store'
})
const latest = latestResponse.ok ? await latestResponse.json() : undefined
process.stdout.write(`published      ${latest?.tag === releaseTag ? 'yes' : 'no'}\n`)
