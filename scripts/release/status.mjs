import process from 'node:process'
import { loadReleaseEnvironment } from './shared/environment.mjs'
import { fetchWithRetry } from './shared/http.mjs'
import {
  PUBLIC_RELEASE_BASE_URL,
  readPublicReleaseFragment,
  resolveAwsExecutable,
  verifyPublicReleaseFragment,
  verifyReleaseStorageFragment
} from './shared/windows.mjs'
import { parseReleaseTag } from './tag.mjs'
import { resolveReleaseStorageConfig } from './storage/config.mjs'

const ROOT = process.cwd()
await loadReleaseEnvironment(ROOT)
const args = process.argv.slice(2)
const tagIndex = args.indexOf('--tag')
const releaseTag = tagIndex >= 0 ? args[tagIndex + 1] || '' : ''
let releaseFamily = ''
try {
  releaseFamily = parseReleaseTag(releaseTag).family
} catch {
  throw new Error('usage: node scripts/release/status.mjs --tag <mac-v1.2.3|windows-v1.2.3>')
}

let publicBaseUrl = PUBLIC_RELEASE_BASE_URL
try {
  publicBaseUrl = resolveReleaseStorageConfig().publicBaseUrl
} catch {
  // Public status checks can still run against the domestic channel without local credentials.
}
const platforms = releaseFamily === 'mac' ? ['macos-arm64'] : ['windows-x64']
const awsExecutable = await resolveAwsExecutable()
if (!awsExecutable) throw new Error('AWS CLI is required to verify release sha512 metadata')
for (const platform of platforms) {
  const fragment = await readPublicReleaseFragment(releaseTag, platform, publicBaseUrl)
  if (!fragment) {
    process.stdout.write(`${platform.padEnd(14)} missing\n`)
    continue
  }
  await verifyPublicReleaseFragment(fragment, publicBaseUrl)
  await verifyReleaseStorageFragment(fragment, awsExecutable)
  const application = fragment.audit.applications[0]
  const installedMiB = (Number(application.totalBytes || 0) / 1024 / 1024).toFixed(1)
  process.stdout.write(`${platform.padEnd(14)} ready, audited, installed ${installedMiB} MiB\n`)
}

const [windowsLatestResponse, macLatestResponse] = await Promise.all([
  fetchWithRetry(`${publicBaseUrl}/releases/latest/windows.json?check=${Date.now()}`, {
    cache: 'no-store'
  }),
  fetchWithRetry(`${publicBaseUrl}/releases/latest/macos.json?check=${Date.now()}`, {
    cache: 'no-store'
  })
])
const windowsLatest = windowsLatestResponse.ok ? await windowsLatestResponse.json() : undefined
const macLatest = macLatestResponse.ok ? await macLatestResponse.json() : undefined
if (releaseFamily === 'windows') {
  process.stdout.write(`windows live   ${windowsLatest?.tag === releaseTag ? 'yes' : 'no'}\n`)
} else {
  process.stdout.write(`macos live     ${macLatest?.tag === releaseTag ? 'yes' : 'no'}\n`)
}
