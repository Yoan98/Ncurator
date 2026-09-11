import {
  DOMESTIC_DOWNLOAD_BASE_URL,
  GLOBAL_DOWNLOAD_BASE_URL
} from '../storage/config.mjs'
import { fetchWithRetry } from './http.mjs'
import { parseReleaseTag } from '../tag.mjs'

const LATEST_MANIFEST = {
  mac: 'releases/latest/macos.json',
  windows: 'releases/latest/windows.json'
}

export const RELEASE_PUBLIC_BASE_URLS = [DOMESTIC_DOWNLOAD_BASE_URL, GLOBAL_DOWNLOAD_BASE_URL]

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
