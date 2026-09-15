import { WPS_ADDON_HOSTS, WPS_ADDON_LEGACY_NAMES, WPS_ADDON_NAME } from './constants'

type AuthEntry = {
  enable?: boolean
  md5?: string
  mode?: number
  name?: string
  path?: string
}

const NAMELIST_KEY = 'namelist'

const namesToRewrite = (): Set<string> => new Set([WPS_ADDON_NAME, ...WPS_ADDON_LEGACY_NAMES])

const normalizeAddonLoopbackUrl = (addonUrl: string): string =>
  addonUrl.endsWith('/') ? addonUrl : `${addonUrl}/`

export const addonUrlsEquivalent = (left: string, right: string): boolean =>
  left.trim().replace(/\/+$/, '').toLowerCase() === right.trim().replace(/\/+$/, '').toLowerCase()

const eachAddonAuthEntry = (
  raw: string,
  visit: (entry: AuthEntry) => void
): boolean => {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return false
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false

  const names = namesToRewrite()
  for (const host of WPS_ADDON_HOSTS) {
    const section = parsed[host]
    if (!section || typeof section !== 'object' || Array.isArray(section)) continue
    const record = section as Record<string, unknown>
    for (const [key, value] of Object.entries(record)) {
      if (key === NAMELIST_KEY || !value || typeof value !== 'object' || Array.isArray(value)) continue
      const entry = value as AuthEntry
      if (!entry.name || !names.has(entry.name)) continue
      visit(entry)
    }
  }
  return true
}

export const authAddinNeedsRewrite = (raw: string, addonUrl: string): boolean => {
  let sawEntry = false
  let needsRewrite = false
  const parsed = eachAddonAuthEntry(raw, (entry) => {
    sawEntry = true
    if (entry.mode !== 2) needsRewrite = true
    if (!addonUrlsEquivalent(String(entry.path || ''), addonUrl)) needsRewrite = true
  })
  return parsed && sawEntry && needsRewrite
}

export const mergeAuthAddin = (raw: string, addonUrl: string): string => {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return raw
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return raw

  const names = namesToRewrite()
  const normalizedUrl = normalizeAddonLoopbackUrl(addonUrl)
  for (const host of WPS_ADDON_HOSTS) {
    const section = parsed[host]
    if (!section || typeof section !== 'object' || Array.isArray(section)) continue
    const record = section as Record<string, unknown>
    for (const [key, value] of Object.entries(record)) {
      if (key === NAMELIST_KEY || !value || typeof value !== 'object' || Array.isArray(value)) continue
      const entry = value as AuthEntry
      if (!entry.name || !names.has(entry.name)) continue
      entry.mode = 2
      if (!addonUrlsEquivalent(String(entry.path || ''), normalizedUrl)) {
        entry.path = normalizedUrl
      }
    }
  }
  return `${JSON.stringify(parsed, null, 4)}\n`
}
