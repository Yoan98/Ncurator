import { pathToFileURL } from 'node:url'
import { WPS_ADDON_HOSTS, WPS_ADDON_LEGACY_NAMES, WPS_ADDON_NAME } from './constants'

const PLUGIN_TAG = /<jspluginonline\b[^>]*\/?>/gi

const escapeXml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const namesToReplace = (): Set<string> => new Set([WPS_ADDON_NAME, ...WPS_ADDON_LEGACY_NAMES])

const readAttribute = (tag: string, name: string): string | undefined =>
  new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(tag)?.[1]

export const toAddonFileUrl = (addonDir: string): string => {
  const url = pathToFileURL(addonDir).href
  return url.endsWith('/') ? url : `${url}/`
}

export const mergePublishXml = (raw: string, addonFileUrl: string): string => {
  const replaceNames = namesToReplace()
  const source = String(raw || '').trim() || '<jsplugins>\n</jsplugins>'
  const kept: string[] = []
  const scanned = source.replace(PLUGIN_TAG, (tag) => {
    const name = readAttribute(tag, 'name')
    if (name && replaceNames.has(name)) return ''
    kept.push(tag.trim())
    return ''
  })
  const leftover = scanned.replace(/<\/?jsplugins>/gi, '').trim()
  if (leftover) {
    leftover
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => kept.push(line))
  }
  const uniqueKept = [...new Set(kept)]
  const entries = WPS_ADDON_HOSTS.map(
    (type) =>
      `<jspluginonline name="${WPS_ADDON_NAME}" type="${type}" url="${escapeXml(addonFileUrl)}" enable="true" install=""/>`
  )
  const inner = [...uniqueKept, ...entries].join('\n')
  return `<jsplugins>\n${inner}\n</jsplugins>\n`
}
