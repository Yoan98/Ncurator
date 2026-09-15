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

const namelistTokens = (value: unknown): string[] => {
  if (typeof value !== 'string') return []
  const trimmed = value.trim()
  if (!trimmed) return []
  if (trimmed.includes(',') || trimmed.includes(';')) {
    return trimmed
      .split(/[,;]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return [trimmed]
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
    const knownKeys = new Set(Object.keys(record).filter((key) => key !== NAMELIST_KEY))
    for (const [key, value] of Object.entries(record)) {
      if (key === NAMELIST_KEY || !value || typeof value !== 'object' || Array.isArray(value)) continue
      const entry = value as AuthEntry
      if (!entry.name || !names.has(entry.name)) continue
      entry.mode = 2
      entry.path = normalizedUrl
    }
    if (!Object.prototype.hasOwnProperty.call(record, NAMELIST_KEY)) continue
    const kept = namelistTokens(record[NAMELIST_KEY]).filter((token) => knownKeys.has(token))
    if (kept.length === 0) {
      delete record[NAMELIST_KEY]
    } else {
      record[NAMELIST_KEY] = kept.join(',')
    }
  }
  return `${JSON.stringify(parsed, null, 4)}\n`
}
