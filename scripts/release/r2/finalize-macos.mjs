import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { assertReleaseFragment } from './fragment-contract.mjs'
import { fetchWithRetry } from '../shared/http.mjs'
import { createReleaseStorageClient } from '../storage/client.mjs'
import { artifactKey, statusKey } from './storage-layout.mjs'
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

const { aws, bucket, publicBaseUrl, listKeys, deleteKeys, label } =
  await createReleaseStorageClient(ROOT)
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
      throw new Error(`${label} object does not match release fragment: ${key}`)
    }
  }
  return fragment
}

try {
  const arm64 = await downloadAndVerifyFragment('macos-arm64')

  const metadataInput = path.join(workDirectory, 'metadata-input')
  const metadataOutput = path.join(workDirectory, 'metadata-output')
  await mkdir(metadataInput, { recursive: true })
  await writeFile(path.join(metadataInput, 'latest-mac.yml'), arm64.metadata, 'utf8')
  await execFileAsync(process.execPath, [
    path.join(ROOT, 'scripts', 'release', 'r2', 'metadata.mjs'),
    metadataInput,
    metadataOutput,
    releaseTag,
    path.join(workDirectory, 'macos-arm64.json')
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

  const installer = arm64.files.find((file) => file.role === 'installer')
  const installerKey = artifactKey(arm64, installer.name)
  const installerUrl = `${publicBaseUrl}/${installerKey}`
  const downloadName = installer.name

  const download = {
    name: downloadName,
    url: installerUrl,
    size: installer.size,
    sha512: installer.sha512
  }
  const manifest = {
    schemaVersion: 2,
    platform: 'macos',
    version: arm64.version,
    tag: arm64.tag,
    publishedAt: new Date().toISOString(),
    downloads: { arm64: download }
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
    !metadata.includes(`artifacts/macos/${releaseTag}/Ncurator-mac-arm64.zip`)
  ) {
    throw new Error('public latest-mac.yml does not match the Mac release')
  }
  const originInstaller = JSON.parse(
    (
      await aws([
        's3api',
        'head-object',
        '--bucket',
        bucket,
        '--key',
        installerKey,
        '--output',
        'json'
      ])
    ).stdout
  )
  if (Number(originInstaller.ContentLength) !== installer.size) {
    throw new Error(`origin macOS artifact size verification failed: ${installerKey}`)
  }

  const response = await fetchWithRetry(`${installerUrl}?check=${Date.now()}`, {
    method: 'HEAD',
    cache: 'no-store'
  })
  if (!response.ok || Number(response.headers.get('content-length')) !== installer.size) {
    throw new Error(`public macOS artifact download verification failed: ${installerKey}`)
  }
  if (!installerUrl.endsWith(`/${encodeURI(downloadName)}`) && !installerUrl.endsWith(`/${downloadName}`)) {
    throw new Error(`macOS installer URL must end with the user-visible name: ${installerUrl}`)
  }

  const publicManifestResponse = await fetchWithRetry(
    `${publicBaseUrl}/releases/latest/macos.json?check=${Date.now()}`,
    { cache: 'no-store' }
  )
  const publicManifest = publicManifestResponse.ok
    ? await publicManifestResponse.json()
    : undefined
  if (
    publicManifest?.version !== arm64.version ||
    publicManifest?.downloads?.arm64?.name !== downloadName ||
    publicManifest?.downloads?.arm64?.url !== installerUrl
  ) {
    throw new Error('public macOS release manifest verification failed')
  }

  const removable = (await listKeys('artifacts/macos/')).filter(
    (key) => !key.startsWith(`artifacts/macos/${releaseTag}/`)
  )
  const activeArtifactKeys = new Set(
    arm64.files.map((file) => artifactKey(arm64, file.name))
  )
  removable.push(
    ...(await listKeys(`artifacts/macos/${releaseTag}/`)).filter(
      (key) => !activeArtifactKeys.has(key)
    )
  )
  removable.push(
    ...(await listKeys('release-status/macos/')).filter(
      (key) => !key.startsWith(`release-status/macos/${releaseTag}/`)
    )
  )
  const activeStatusKey = statusKey(releaseTag, arm64.platform)
  removable.push(
    ...(await listKeys(`release-status/macos/${releaseTag}/`)).filter(
      (key) => key !== activeStatusKey
    )
  )
  removable.push(...(await listKeys('downloads/latest/')))
  removable.push(
    ...(await listKeys('artifacts/v')).filter((key) => /\/Ncurator-mac-[^/]+$/u.test(key))
  )
  removable.push(
    ...(await listKeys('release-status/v')).filter((key) => /\/macos-arm64\.json$/u.test(key))
  )
  await deleteKeys(removable)
  process.stdout.write(`[release] macOS arm64 ${releaseTag} is live at ${installerUrl}\n`)
} finally {
  await rm(workDirectory, { recursive: true, force: true })
}
