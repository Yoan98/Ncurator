import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  DOMESTIC_DOWNLOAD_BASE_URL,
  GLOBAL_DOWNLOAD_BASE_URL,
  resolveReleaseStorageConfig
} from '../storage/config.mjs'
import { fetchWithRetry } from './http.mjs'
import { compareReleaseVersions, parseReleaseTag } from '../tag.mjs'
import { artifactKey } from '../r2/storage-layout.mjs'
import YAML from 'yaml'

const execFileAsync = promisify(execFile)

const LATEST_MANIFEST = {
  mac: 'releases/latest/macos.json',
  windows: 'releases/latest/windows.json'
}

export const RELEASE_PUBLIC_BASE_URLS = [DOMESTIC_DOWNLOAD_BASE_URL, GLOBAL_DOWNLOAD_BASE_URL]

export const isReleaseChannelCurrent = async (fragment, base, fetchImpl = fetchWithRetry) => {
  const { family, version } = parseReleaseTag(fragment.tag, fragment.platform)
  const metadataPath =
    family === 'mac' ? 'updates/latest/latest-mac.yml' : 'updates/latest/latest.yml'
  const responses = await Promise.all(
    [LATEST_MANIFEST[family], metadataPath].map((key) =>
      fetchImpl(`${base}/${key}?check=${Date.now()}`, { cache: 'no-store' })
    )
  )
  for (const response of responses) {
    if (!response.ok && response.status !== 404) {
      throw new Error(`public release channel lookup failed: HTTP ${response.status}`)
    }
  }
  const manifest = responses[0].ok ? await responses[0].json() : undefined
  const metadata = responses[1].ok ? YAML.parse(await responses[1].text()) : undefined
  for (const current of [manifest, metadata]) {
    if (!current) continue
    if (!/^\d+\.\d+\.\d+$/u.test(current.version)) {
      throw new Error('public release channel version is invalid')
    }
    if (compareReleaseVersions(current.version, version) > 0) {
      throw new Error(
        `public channel already contains newer ${current.version}; refuse to downgrade`
      )
    }
  }
  if (manifest?.version === version && manifest.tag !== fragment.tag) {
    throw new Error(`public channel tag differs from ${fragment.tag}`)
  }
  const installer = fragment.files.find((file) => file.role === 'installer')
  const download = manifest?.downloads?.[family === 'mac' ? 'arm64' : 'x64']
  const expectedUpdates = fragment.files.filter((file) =>
    family === 'mac' ? file.name.endsWith('.zip') : file.role === 'installer'
  )
  return (
    manifest?.tag === fragment.tag &&
    metadata?.version === version &&
    download?.name === installer.name &&
    download.size === installer.size &&
    download.sha512 === installer.sha512 &&
    download.url === `${base}/${artifactKey(fragment, installer.name)}` &&
    expectedUpdates.every((file) =>
      metadata.files?.some(
        (entry) =>
          decodeURI(new URL(entry.url, `${base}/${metadataPath}`).href) ===
            `${base}/${artifactKey(fragment, file.name)}` &&
          entry.sha512 === file.sha512 &&
          entry.size === file.size
      )
    )
  )
}

export const findLiveChannelsForTag = async (releaseTag, fetchImpl = fetchWithRetry) => {
  const { family } = parseReleaseTag(releaseTag)
  const manifestPath = LATEST_MANIFEST[family]
  const live = []

  for (const base of RELEASE_PUBLIC_BASE_URLS) {
    const response = await fetchImpl(`${base}/${manifestPath}?check=${Date.now()}`, {
      cache: 'no-store'
    }).catch(() => undefined)
    if (!response?.ok) continue
    const manifest = await response.json().catch(() => undefined)
    if (manifest?.tag === releaseTag) live.push(base)
  }

  return live
}

export const verifyPublicReleaseFragment = async (
  fragment,
  publicBaseUrl = DOMESTIC_DOWNLOAD_BASE_URL,
  fetchImpl = fetchWithRetry
) => {
  for (const file of fragment.files) {
    const response = await fetchImpl(`${publicBaseUrl}/${artifactKey(fragment, file.name)}`, {
      method: 'HEAD',
      cache: 'no-store'
    })
    if (!response.ok || Number(response.headers.get('content-length')) !== file.size) {
      throw new Error(`remote release asset verification failed: ${file.name}`)
    }
  }
}

export const verifyReleaseStorageFragment = async (
  fragment,
  awsExecutable,
  config = resolveReleaseStorageConfig()
) => {
  if (!awsExecutable) throw new Error(`${config.label} verification configuration is incomplete`)
  const { createAwsCliRuntime } = await import('../storage/client.mjs')
  const runtime = await createAwsCliRuntime(config)
  for (const file of fragment.files) {
    const key = artifactKey(fragment, file.name)
    const result = await execFileAsync(
      awsExecutable,
      [
        's3api',
        'head-object',
        '--bucket',
        config.bucket,
        '--key',
        key,
        '--output',
        'json',
        ...runtime.extraArgs
      ],
      { env: runtime.env }
    )
    const remote = JSON.parse(result.stdout)
    if (Number(remote.ContentLength) !== file.size || remote.Metadata?.sha512 !== file.sha512) {
      throw new Error(`${config.label} release asset does not match fragment: ${key}`)
    }
  }
}
