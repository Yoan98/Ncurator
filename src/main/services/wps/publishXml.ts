import { WPS_ADDON_HOSTS, WPS_ADDON_LEGACY_NAMES, WPS_ADDON_NAME } from './constants'

const PLUGIN_TAG = /<jsplugin(?:online)?\b[^>]*\/?>/gi

const escapeXml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const namesToReplace = (): Set<string> => new Set([WPS_ADDON_NAME, ...WPS_ADDON_LEGACY_NAMES])

const readAttribute = (tag: string, name: string): string | undefined =>
  new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(tag)?.[1]

export const toAddonLoopbackUrl = (port: number): string => `http://127.0.0.1:${port}/addon/`

export const publishXmlHasAddonUrl = (raw: string, addonUrl: string): boolean => {
  const url = escapeXml(addonUrl)
  return WPS_ADDON_HOSTS.every((type) =>
    raw.includes(`<jspluginonline name="${WPS_ADDON_NAME}" type="${type}" url="${url}"`)
  )
}

export const mergePublishXml = (raw: string, addonUrl: string): string => {
  const replaceNames = namesToReplace()
  const source = String(raw || '').trim() || '<jsplugins>\n</jsplugins>'
  const kept: string[] = []
  const scanned = source.replace(PLUGIN_TAG, (tag) => {
    const name = readAttribute(tag, 'name')
    if (name && replaceNames.has(name)) return ''
    kept.push(tag.trim())
    return ''
  })
  const leftover = scanned
    .replace(/<\/?jsplugins>/gi, '')
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .trim()
  if (leftover) {
    leftover
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => kept.push(line))
  }
  const uniqueKept = [...new Set(kept)]
  const url = escapeXml(addonUrl)
  const entries = WPS_ADDON_HOSTS.map(
    (type) =>
      `<jspluginonline name="${WPS_ADDON_NAME}" type="${type}" url="${url}" debug="" enable="enable_dev" install="null"/>`
  )
  const inner = [...uniqueKept, ...entries].join('\n')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<jsplugins>\n${inner}\n</jsplugins>\n`
}
