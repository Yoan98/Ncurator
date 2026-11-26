/**
 * Standard Markdown link helpers for assistant delivery.
 *
 * AI emits CommonMark / GFM links: `[label](destination)` or `[label](<destination>)`.
 * Bare URLs / `www.…` are not treated as links (renderer disables GFM autolink literals).
 * File reachability is stored as a sidecar (`MarkdownLinkAccessEntry[]`), never rewritten
 * into the markdown body. http(s) links are not probed and stay openable by default.
 */

import type { MarkdownLinkAccessEntry, MarkdownLinkResourceType } from './types'
import { parseNcuratorRefHref } from './ncuratorRef'

export type {
  MarkdownLinkAccessEntry,
  MarkdownLinkAccessStatus,
  MarkdownLinkResourceType
} from './types'

export type OpenableMarkdownReference = {
  resourceType: MarkdownLinkResourceType
  label: string
  path: string
}

export type ResolvedMarkdownLink =
  | {
      mode: 'unavailable'
      reason: 'access' | 'unknown' | 'legacy_invalid'
    }
  | {
      mode: 'openable'
      reference: OpenableMarkdownReference
    }
  | {
      mode: 'external'
      href: string
    }

export type ClassifiedMarkdownHref =
  | { type: 'file'; href: string; path: string }
  | { type: 'web'; href: string; url: string }
  | { type: 'unknown'; href: string }

const WINDOWS_ABS_PATH_RE = /^[a-zA-Z]:[\\/]/
const UNIX_ABS_PATH_RE = /^\//

const isEscapedAt = (value: string, index: number): boolean => {
  let slashCount = 0
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    slashCount += 1
  }
  return slashCount % 2 === 1
}

const findMarkdownLinkTextEnd = (markdown: string, startIndex: number): number => {
  for (let cursor = startIndex + 1; cursor < markdown.length; cursor += 1) {
    if (markdown[cursor] === ']' && !isEscapedAt(markdown, cursor)) return cursor
  }
  return -1
}

const findMarkdownDestinationEnd = (markdown: string, startIndex: number): number => {
  let depth = 0
  for (let cursor = startIndex; cursor < markdown.length; cursor += 1) {
    const char = markdown[cursor]
    if (isEscapedAt(markdown, cursor)) continue
    if (char === '(') {
      depth += 1
      continue
    }
    if (char === ')') {
      if (depth === 0) return cursor
      depth -= 1
    }
  }
  return -1
}

/** Unwrap `<destination>` / trim; leave other destinations intact. */
export const unwrapMarkdownLinkDestination = (destination: string): string => {
  const trimmed = destination.trim()
  if (trimmed.startsWith('<') && trimmed.endsWith('>') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

/**
 * Decode percent-encoding from react-markdown hrefs so sidecar keys match
 * the raw destinations extracted from markdown source.
 */
export const decodeMarkdownHref = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Normalize a filesystem path for access checks and open actions.
 * Does not mutate markdown; only used for classification / sidecar keys matching.
 */
export const normalizeLocalPath = (pathValue: string): string =>
  decodeMarkdownHref(pathValue.trim())
    .replace(/^file:\/\//i, '')
    .replace(/^\/([a-zA-Z]:[\\/])/, '$1')
    .replace(/^([a-zA-Z]:)(?![\\/])/, '$1/')
    .replace(/\\/g, '/')

export const classifyMarkdownHref = (rawHref: string): ClassifiedMarkdownHref => {
  const href = decodeMarkdownHref(unwrapMarkdownLinkDestination(rawHref))
  if (!href) return { type: 'unknown', href }

  const lower = href.toLowerCase()
  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    return { type: 'web', href, url: href }
  }

  if (lower.startsWith('file://')) {
    const path = normalizeLocalPath(href)
    return path ? { type: 'file', href, path } : { type: 'unknown', href }
  }

  // Legacy in-app refs still classify from embedded path.
  if (lower.startsWith('ncurator://ref?')) {
    return { type: 'unknown', href }
  }

  if (WINDOWS_ABS_PATH_RE.test(href) || UNIX_ABS_PATH_RE.test(href)) {
    const path = normalizeLocalPath(href)
    return path ? { type: 'file', href, path } : { type: 'unknown', href }
  }

  return { type: 'unknown', href }
}

export const extractMarkdownLinkHrefs = (markdown: string): string[] => {
  const hrefs: string[] = []
  let cursor = 0

  while (cursor < markdown.length) {
    const linkTextStart = markdown.indexOf('[', cursor)
    if (linkTextStart === -1) break

    const linkTextEnd = findMarkdownLinkTextEnd(markdown, linkTextStart)
    if (linkTextEnd === -1 || markdown[linkTextEnd + 1] !== '(') {
      cursor = linkTextStart + 1
      continue
    }

    const destinationStart = linkTextEnd + 2
    const destinationEnd = findMarkdownDestinationEnd(markdown, destinationStart)
    if (destinationEnd === -1) break

    const href = unwrapMarkdownLinkDestination(markdown.slice(destinationStart, destinationEnd))
    if (href) hrefs.push(href)
    cursor = destinationEnd + 1
  }

  return hrefs
}

/** Lookup key used both when writing sidecar and when matching rendered hrefs. */
export const markdownLinkAccessKey = (href: string): string => {
  const classified = classifyMarkdownHref(href)
  if (classified.type === 'file') return `file\u0000${classified.path}`
  if (classified.type === 'web') return `web\u0000${classified.url}`
  return `unknown\u0000${unwrapMarkdownLinkDestination(href)}`
}

export const findMarkdownLinkAccess = (
  linkAccess: MarkdownLinkAccessEntry[] | undefined,
  href: string
): MarkdownLinkAccessEntry | undefined => {
  if (!linkAccess || linkAccess.length === 0) return undefined
  const key = markdownLinkAccessKey(href)
  return linkAccess.find((entry) => markdownLinkAccessKey(entry.href) === key)
}

/**
 * Resolve a rendered href for UI.
 * - Legacy `ncurator://ref` uses embedded accessStatus.
 * - http(s) links are always openable (no reachability sidecar).
 * - Local files: when `linkAccess` is defined (delivery finished), match sidecar;
 *   missing / unavailable → unavailable. When undefined (streaming), stay openable.
 */
export const resolveMarkdownLinkForRender = (input: {
  href?: string
  linkAccess?: MarkdownLinkAccessEntry[]
  label: string
}): ResolvedMarkdownLink => {
  const href = input.href || ''
  const legacy = parseNcuratorRefHref(href)
  if (legacy.type === 'invalid') {
    return { mode: 'unavailable', reason: 'legacy_invalid' }
  }
  if (legacy.type === 'reference') {
    if (legacy.kind === 'reference' && legacy.accessStatus === 'unavailable') {
      return { mode: 'unavailable', reason: 'access' }
    }
    return {
      mode: 'openable',
      reference: {
        resourceType: legacy.resourceType,
        label: legacy.label || input.label,
        path: legacy.path
      }
    }
  }

  const classified = classifyMarkdownHref(href)
  if (classified.type === 'unknown') {
    if (input.linkAccess !== undefined) {
      return { mode: 'unavailable', reason: 'unknown' }
    }
    return href ? { mode: 'external', href } : { mode: 'unavailable', reason: 'unknown' }
  }

  if (classified.type === 'web') {
    return {
      mode: 'openable',
      reference: {
        resourceType: 'web',
        label: input.label,
        path: classified.url
      }
    }
  }

  if (input.linkAccess !== undefined) {
    const access = findMarkdownLinkAccess(input.linkAccess, href)
    if (!access || access.accessStatus === 'unavailable') {
      return { mode: 'unavailable', reason: 'access' }
    }
  }

  return {
    mode: 'openable',
    reference: {
      resourceType: 'file',
      label: input.label,
      path: classified.path
    }
  }
}

/**
 * Allow local paths / file / legacy ncurator refs through react-markdown's URL transform.
 * Blocks dangerous schemes the same way as the default transform.
 */
export const transformAssistantMarkdownUrl = (url: string): string => {
  const value = String(url || '').trim()
  if (!value) return value
  const lower = value.toLowerCase()
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('data:')
  ) {
    return ''
  }
  return value
}

const FENCE_LINE_RE = /^ {0,3}(`{3,}|~{3,})/u

/**
 * Mask positions that belong to fenced code blocks or inline code spans, so the
 * destination repair below never rewrites code samples.
 */
const maskMarkdownCodeSegments = (markdown: string): Uint8Array => {
  const mask = new Uint8Array(markdown.length)
  let lineStart = 0
  let openFence: { char: string; size: number } | null = null

  while (lineStart <= markdown.length) {
    const newlineIndex = markdown.indexOf('\n', lineStart)
    const lineEnd = newlineIndex === -1 ? markdown.length : newlineIndex
    const fenceMatch = FENCE_LINE_RE.exec(markdown.slice(lineStart, lineEnd))

    if (openFence) {
      mask.fill(1, lineStart, lineEnd)
      if (
        fenceMatch &&
        fenceMatch[1][0] === openFence.char &&
        fenceMatch[1].length >= openFence.size
      ) {
        openFence = null
      }
    } else if (fenceMatch) {
      openFence = { char: fenceMatch[1][0], size: fenceMatch[1].length }
      mask.fill(1, lineStart, lineEnd)
    }

    if (newlineIndex === -1) break
    lineStart = newlineIndex + 1
  }

  let cursor = 0
  while (cursor < markdown.length) {
    if (mask[cursor] || markdown[cursor] !== '`') {
      cursor += 1
      continue
    }

    let runEnd = cursor
    while (markdown[runEnd] === '`') runEnd += 1
    const runLength = runEnd - cursor

    let search = runEnd
    let closingEnd = -1
    while (search < markdown.length) {
      if (markdown[search] !== '`') {
        search += 1
        continue
      }
      let end = search
      while (markdown[end] === '`') end += 1
      if (end - search === runLength) {
        closingEnd = end
        break
      }
      search = end
    }

    if (closingEnd === -1) {
      cursor = runEnd
      continue
    }
    mask.fill(1, cursor, closingEnd)
    cursor = closingEnd
  }

  return mask
}

const looksLikeLinkTarget = (value: string): boolean => {
  if (/^(?:[a-zA-Z]:[\\/]|\/|~[\\/]|\.{1,2}[\\/])/u.test(value)) return true
  if (/^(?:https?|file):\/\//iu.test(value)) return true
  return /\.[a-z0-9]{1,8}$/iu.test(value)
}

const wrapSpacedDestination = (destination: string): string => {
  const trimmed = destination.trim()
  if (!trimmed || !/\s/u.test(trimmed)) return destination
  if (trimmed.startsWith('<') || trimmed.endsWith('>')) return destination
  // `[label](path "title")` keeps its title; wrapping would swallow it.
  if (/["'“”]/u.test(trimmed)) return destination
  if (!looksLikeLinkTarget(trimmed)) return destination
  return `<${trimmed}>`
}

const normalizeWindowsDestination = (destination: string, withTitle = false): string => {
  if (!/^(?:file:\/\/\/?)?[a-zA-Z]:[\\/]/iu.test(destination.trim())) return destination
  // Backslashes before punctuation are CommonMark escapes, including `\.` in dot directories.
  const titleStart = withTitle ? destination.search(/\s+["']/u) : -1
  const pathEnd = titleStart < 0 ? destination.length : titleStart
  return destination.slice(0, pathEnd).replace(/\\/g, '/') + destination.slice(pathEnd)
}

/**
 * Normalize Windows separators before CommonMark consumes backslash escapes,
 * and wrap destinations containing spaces, e.g. `[报告](/Users/me/My Docs/a.pdf)`.
 *
 * CommonMark rejects a bare destination with spaces, so such links silently
 * degrade to plain text and the UI loses the reference. Repairing them here keeps
 * the model contract to "write a normal Markdown link"; code samples are left
 * untouched.
 */
export const repairMarkdownLinkDestinations = (markdown: string): string => {
  if (!markdown.includes('](')) return markdown
  const codeMask = maskMarkdownCodeSegments(markdown)
  let output = ''
  let cursor = 0

  while (cursor < markdown.length) {
    const markerIndex = markdown.indexOf('](', cursor)
    if (markerIndex === -1) break

    const destinationStart = markerIndex + 2
    if (codeMask[markerIndex] || codeMask[destinationStart]) {
      output += markdown.slice(cursor, destinationStart)
      cursor = destinationStart
      continue
    }

    if (markdown[destinationStart] === '<') {
      const angleEnd = markdown.indexOf('>', destinationStart + 1)
      if (angleEnd !== -1) {
        output +=
          markdown.slice(cursor, destinationStart + 1) +
          normalizeWindowsDestination(markdown.slice(destinationStart + 1, angleEnd))
        cursor = angleEnd
        continue
      }
      output += markdown.slice(cursor, destinationStart + 1)
      cursor = destinationStart + 1
      continue
    }

    let destinationEnd = -1
    for (let index = destinationStart; index < markdown.length; index += 1) {
      const char = markdown[index]
      if (char === '\n') break
      if (char === ')' && !isEscapedAt(markdown, index)) {
        destinationEnd = index
        break
      }
    }

    if (destinationEnd === -1) {
      output += markdown.slice(cursor, destinationStart)
      cursor = destinationStart
      continue
    }

    const destination = markdown.slice(destinationStart, destinationEnd)
    output +=
      markdown.slice(cursor, destinationStart) +
      wrapSpacedDestination(normalizeWindowsDestination(destination, true))
    cursor = destinationEnd
  }

  return output + markdown.slice(cursor)
}
