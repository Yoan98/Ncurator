import { WPS_ADDON_HOSTS, WPS_ADDON_LEGACY_NAMES, WPS_ADDON_NAME } from './constants'

type AuthEntry = {
  enable?: boolean
  md5?: string
  mode?: number
  name?: string
  path?: string
}

const namesToRewrite = (): Set<string> => new Set([WPS_ADDON_NAME, ...WPS_ADDON_LEGACY_NAMES])

export const mergeAuthAddin = (raw: string, addonUrl: string): string => {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return raw
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return raw

  const names = namesToRewrite()
  for (const host of WPS_ADDON_HOSTS) {
    const section = parsed[host]
    if (!section || typeof section !== 'object' || Array.isArray(section)) continue
    const record = section as Record<string, unknown>
    for (const [key, value] of Object.entries(record)) {
      if (key === 'namelist' || !value || typeof value !== 'object' || Array.isArray(value)) continue
      const entry = value as AuthEntry
      if (!entry.name || !names.has(entry.name)) continue
      entry.mode = 2
      entry.path = addonUrl
    }
  }
  return `${JSON.stringify(parsed, null, 4)}\n`
}
