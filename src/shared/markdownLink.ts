/**
 * Standard Markdown link helpers for assistant delivery.
 *
 * AI emits CommonMark / GFM links: `[label](destination)` or `[label](<destination>)`.
 * Bare URLs / `www.…` are not treated as links (renderer disables GFM autolink literals).
 * Access status is stored as a sidecar (`MarkdownLinkAccessEntry[]`), never rewritten
 * into the markdown body.
 */

import type { MarkdownLinkAccessEntry } from './types'

export type {
  MarkdownLinkAccessEntry,
  MarkdownLinkAccessStatus,
  MarkdownLinkResourceType
} from './types'

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
 * Normalize a filesystem path for access checks and open actions.
 * Does not mutate markdown; only used for classification / sidecar keys matching.
 */
export const normalizeLocalPath = (pathValue: string): string =>
  pathValue
    .trim()
    .replace(/^file:\/\//i, '')
    .replace(/^\/([a-zA-Z]:[\\/])/, '$1')
    .replace(/^([a-zA-Z]:)(?![\\/])/, '$1/')
    .replace(/\\/g, '/')

export const classifyMarkdownHref = (rawHref: string): ClassifiedMarkdownHref => {
  const href = unwrapMarkdownLinkDestination(rawHref)
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
