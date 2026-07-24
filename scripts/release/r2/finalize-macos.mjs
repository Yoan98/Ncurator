import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { assertReleaseFragment } from './fragment-contract.mjs'
import { fetchWithRetry } from '../shared/http.mjs'
import { createR2Client } from './client.mjs'
import { artifactKey, fixedDownloadKey, statusKey } from './storage-layout.mjs'
import { parseReleaseTag } from '../tag.mjs'

const execFileAsync = promisify(execFile)
const ROOT = process.cwd()
const args = process.argv.slice(2)
const tagIndex = args.indexOf('--tag')
const releaseTag = tagIndex >= 0 ? args[tagIndex + 1] || '' : ''
let releaseVersion = ''
try {
  releaseVersion = parseReleaseTag(releaseTag, 'mac').version
} catch {
  throw new Error('usage: node scripts/release/r2/finalize-macos.mjs --tag <mac-v1.2.3>')
}

const { aws, bucket, publicBaseUrl, listKeys, deleteKeys } = await createR2Client(ROOT)
const workDirectory = await mkdtemp(path.join(os.tmpdir(), `ncurator-macos-${releaseTag}-`))

const downloadAndVerifyFragment = async (platform) => {
  const target = path.join(workDirectory, `${platform}.json`)
  await aws([
    's3',
    'cp',
    `s3://${bucket}/${statusKey(releaseTag, platform)}`,
    target,
    '--no-progress'
  ])
  const fragment = JSON.parse(await readFile(target, 'utf8'))
  assertReleaseFragment(fragment, { tag: releaseTag, platform })
  for (const file of fragment.files) {
    const key = artifactKey(fragment, file.name)
    const remote = JSON.parse(
      (await aws(['s3api', 'head-object', '--bucket', bucket, '--key', key, '--output', 'json']))
        .stdout
    )
    if (Number(remote.ContentLength) !== file.size || remote.Metadata?.sha512 !== file.sha512) {
      throw new Error(`R2 object does not match release fragment: ${key}`)
    }
  }
  return fragment
}

try {
  const [arm64, x64] = await Promise.all([
    downloadAndVerifyFragment('macos-arm64'),
    downloadAndVerifyFragment('macos-x64')
  ])
  if (!arm64.signature || arm64.signature !== x64.signature) {
    throw new Error('macOS arm64 and x64 release signatures do not match')
  }

  const metadataInput = path.join(workDirectory, 'metadata-input')
  const metadataOutput = path.join(workDirectory, 'metadata-output')
  await mkdir(path.join(metadataInput, 'mac-arm64'), { recursive: true })
  await mkdir(path.join(metadataInput, 'mac-x64'), { recursive: true })
  await writeFile(path.join(metadataInput, 'mac-arm64', 'latest-mac.yml'), arm64.metadata, 'utf8')
  await writeFile(path.join(metadataInput, 'mac-x64', 'latest-mac.yml'), x64.metadata, 'utf8')
  await execFileAsync(process.execPath, [
    path.join(ROOT, 'scripts', 'release', 'r2', 'merge-mac-metadata.mjs'),
    metadataInput
  ])
  await execFileAsync(process.execPath, [
    path.join(ROOT, 'scripts', 'release', 'r2', 'metadata.mjs'),
    metadataInput,
    metadataOutput,
    releaseTag
  ])
  await aws([
    's3',
    'cp',
    path.join(metadataOutput, 'latest-mac.yml'),
    `s3://${bucket}/updates/latest/latest-mac.yml`,
    '--content-type',
    'application/yaml',
    '--cache-control',
    'no-store',
    '--no-progress'
  ])

  const installers = new Map()
  for (const fragment of [arm64, x64]) {
    const installer = fragment.files.find((file) => file.role === 'installer')
    const sourceKey = artifactKey(fragment, installer.name)
    const downloadKey = fixedDownloadKey(fragment.platform)
    const downloadName =
      fragment.platform === 'macos-arm64'
        ? `Ncurator-${fragment.version}-macos-arm64.dmg`
        : `Ncurator-${fragment.version}-macos-x64.dmg`
    await aws([
      's3api',
      'copy-object',
      '--bucket',
      bucket,
      '--copy-source',
      `${bucket}/${sourceKey}`,
      '--key',
      downloadKey,
      '--content-type',
      'application/octet-stream',
      '--cache-control',
      'no-store',
      '--content-disposition',
      `attachment; filename="${downloadName}"`,
      '--metadata-directive',
      'REPLACE',
      '--metadata',
      `sha512=${installer.sha512}`
    ])
    installers.set(fragment.platform, { installer, downloadKey, downloadName })
  }

  const toDownload = (platform) => {
    const { installer, downloadKey, downloadName } = installers.get(platform)
    return {
      name: downloadName,
      url: `${publicBaseUrl}/${downloadKey}`,
      size: installer.size,
      sha512: installer.sha512
    }
  }
  const manifest = {
    schemaVersion: 2,
    platform: 'macos',
    version: arm64.version,
    tag: arm64.tag,
    publishedAt: new Date().toISOString(),
    downloads: { arm64: toDownload('macos-arm64'), x64: toDownload('macos-x64') }
  }
  const manifestPath = path.join(workDirectory, 'latest.json')
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await aws([
    's3',
    'cp',
    manifestPath,
    `s3://${bucket}/releases/latest/macos.json`,
    '--content-type',
    'application/json',
    '--cache-control',
    'no-store',
    '--no-progress'
  ])

  const metadataResponse = await fetchWithRetry(
    `${publicBaseUrl}/updates/latest/latest-mac.yml?check=${Date.now()}`,
    { cache: 'no-store' }
  )
  const metadata = metadataResponse.ok ? await metadataResponse.text() : ''
  if (
    !metadata.includes(`version: ${releaseVersion}`) ||
    !metadata.includes(`artifacts/macos/${releaseTag}/Ncurator-mac-arm64.zip`) ||
    !metadata.includes(`artifacts/macos/${releaseTag}/Ncurator-mac-x64.zip`)
  ) {
    throw new Error('public latest-mac.yml does not match the Mac release')
  }
  for (const { installer, downloadKey, downloadName } of installers.values()) {
    const response = await fetchWithRetry(`${publicBaseUrl}/${downloadKey}?check=${Date.now()}`, {
      method: 'HEAD',
      cache: 'no-store'
    })
    if (
      !response.ok ||
      Number(response.headers.get('content-length')) !== installer.size ||
      !String(response.headers.get('content-disposition') || '').includes(
        `filename="${downloadName}"`
      )
    ) {
      throw new Error(`public fixed macOS download verification failed: ${downloadKey}`)
    }
  }

  const removable = (await listKeys('artifacts/macos/')).filter(
    (key) => !key.startsWith(`artifacts/macos/${releaseTag}/`)
  )
  removable.push(
    ...(await listKeys('release-status/macos/')).filter(
      (key) => !key.startsWith(`release-status/macos/${releaseTag}/`)
    )
  )
  removable.push(
    ...(await listKeys('artifacts/v')).filter((key) => /\/Ncurator-mac-[^/]+$/u.test(key))
  )
  removable.push(
    ...(await listKeys('release-status/v')).filter((key) =>
      /\/macos-(?:arm64|x64)\.json$/u.test(key)
    )
  )
  await deleteKeys(removable)
  process.stdout.write(
    `[release] macOS ${releaseTag} is live on independent fixed download channels\n`
  )
} finally {
  await rm(workDirectory, { recursive: true, force: true })
}
