/**
 * Canonical wire format for in-app resource links: `ncurator://ref?…`.
 *
 * These links are emitted by the AI (main process) inside Markdown answers and
 * decoded by the renderer when the user clicks them. Both sides MUST agree on
 * the exact encoding, so the encoder and decoder live here together as the
 * single source of truth. A round-trip test locks the contract.
 *
 * The values (label, path) are percent-encoded selectively: characters that
 * would break either the query string (`URLSearchParams`) or the surrounding
 * CommonMark link destination are encoded; everything else — including CJK
 * text, `/`, `:` and `?` — is left literal so links stay human-readable.
 */

export type NcuratorRefKind = 'reference' | 'normal'
export type NcuratorRefResourceType = 'file' | 'web'
export type NcuratorRefAccessStatus = 'accessible' | 'unavailable'

export type ParsedNcuratorRef =
  | {
      type: 'reference'
      kind: 'reference'
      resourceType: NcuratorRefResourceType
      accessStatus: NcuratorRefAccessStatus
      label: string
      path: string
    }
  | {
      type: 'reference'
      kind: 'normal'
      resourceType: NcuratorRefResourceType
      label: string
      path: string
    }
  | {
      type: 'invalid'
      href: string
      reason: string
    }
  | {
      type: 'normal'
      href?: string
    }

const REF_PREFIX = 'ncurator://ref?'
const REF_QUERY_KEYS = ['kind', 'resourceType', 'accessStatus', 'label', 'path'] as const

/**
 * Characters that must be percent-encoded inside a ref value:
 * - `% & = +` break `URLSearchParams` (separators; `+` decodes to space).
 * - `#` starts a URL fragment.
 * - `\ ( )` are consumed by the CommonMark link-destination parser
 *   (backslash escapes the next char; parens must stay balanced).
 * - `< >` are the pointy-bracket link form / raw HTML.
 * - Whitespace ends a bare link destination.
 * Any other char matched by `\s` (unusual Unicode whitespace) falls back to
 * `encodeURIComponent`.
 */
const REF_VALUE_ENCODE_MAP: Record<string, string> = {
  '%': '%25',
  '&': '%26',
  '=': '%3D',
  '+': '%2B',
  '#': '%23',
  '\\': '%5C',
  '(': '%28',
  ')': '%29',
  '<': '%3C',
  '>': '%3E',
  ' ': '%20',
  '\t': '%09',
  '\r': '%0D',
  '\n': '%0A'
}

const REF_VALUE_ENCODE_RE = /[%&=+#\\()<>\s]/g

export const encodeNcuratorRefValue = (value: string): string =>
  value
    .trim()
    .replace(REF_VALUE_ENCODE_RE, (char) => REF_VALUE_ENCODE_MAP[char] ?? encodeURIComponent(char))

/** Escape characters that would break the `[…]` link-text span in Markdown. */
const escapeMarkdownLinkText = (text: string): string =>
  text.trim().replace(/[\\[\]]/g, (char) => `\\${char}`)

type NcuratorRefBuildInput = {
  label: string
  path: string
  resourceType: NcuratorRefResourceType
} & (
  | { kind: 'reference'; accessStatus: NcuratorRefAccessStatus }
  | { kind: 'normal'; accessStatus?: never }
)

export const buildNcuratorRefHref = (input: NcuratorRefBuildInput): string => {
  const query = [
    `kind=${input.kind}`,
    `resourceType=${input.resourceType}`,
    input.kind === 'reference' ? `accessStatus=${input.accessStatus}` : undefined,
    `label=${encodeNcuratorRefValue(input.label)}`,
    `path=${encodeNcuratorRefValue(input.path)}`
  ]
    .filter((part): part is string => Boolean(part))
    .join('&')
  return `${REF_PREFIX}${query}`
}

export const buildNcuratorRefMarkdown = (input: NcuratorRefBuildInput): string =>
  `[${escapeMarkdownLinkText(input.label)}](${buildNcuratorRefHref(input)})`

const decodeRefValue = (value: string): string => {
  const plusSafeValue = value.replace(/\+/g, '%2B')
  try {
    return decodeURIComponent(plusSafeValue)
  } catch {
    return value
  }
}

const parseRefQuery = (query: string): Partial<Record<(typeof REF_QUERY_KEYS)[number], string>> => {
  const fields: Partial<Record<(typeof REF_QUERY_KEYS)[number], string>> = {}
  let cursor = 0

  while (cursor < query.length) {
    while (query[cursor] === '&') cursor += 1
    if (cursor >= query.length) break

    const equalsIndex = query.indexOf('=', cursor)
    if (equalsIndex === -1) break
    const key = query.slice(cursor, equalsIndex)
    const typedKey = REF_QUERY_KEYS.find((candidate) => candidate === key)
    const valueStart = equalsIndex + 1
    let valueEnd = query.length

    for (const candidate of REF_QUERY_KEYS) {
      const marker = `&${candidate}=`
      const markerIndex = query.indexOf(marker, valueStart)
      if (markerIndex !== -1 && markerIndex < valueEnd) {
        valueEnd = markerIndex
      }
    }

    if (typedKey) {
      fields[typedKey] = decodeRefValue(query.slice(valueStart, valueEnd))
    }
    cursor = valueEnd + 1
  }

  return fields
}

const normalizeRefPath = (path: string): string =>
  path
    .trim()
    .replace(/^\/([a-zA-Z]:[\\/])/, '$1')
    .replace(/^([a-zA-Z]:)(?![\\/])/, '$1/')

export const parseNcuratorRefHref = (href?: string): ParsedNcuratorRef => {
  if (!href?.startsWith(REF_PREFIX)) {
    return { type: 'normal', href }
  }

  try {
    const params = parseRefQuery(href.slice(REF_PREFIX.length))
    const rawKind = params.kind
    const rawResourceType = params.resourceType
    const rawAccessStatus = params.accessStatus
    const path = normalizeRefPath(params.path || '')
    if (!path) return { type: 'invalid', href, reason: 'missing_path' }
    if (rawKind !== 'reference' && rawKind !== 'normal') {
      return { type: 'invalid', href, reason: 'invalid_kind' }
    }
    if (rawResourceType !== 'file' && rawResourceType !== 'web') {
      return { type: 'invalid', href, reason: 'invalid_resource_type' }
    }
    const normalizedPath = path.replace(/\\/g, '/')
    const fallbackLabel = normalizedPath.split('/').filter(Boolean).pop() || normalizedPath || path
    const label = params.label || fallbackLabel
    return rawKind === 'reference'
      ? {
          type: 'reference',
          kind: rawKind,
          resourceType: rawResourceType,
          accessStatus: rawAccessStatus === 'accessible' ? 'accessible' : 'unavailable',
          label,
          path
        }
      : {
          type: 'reference',
          kind: rawKind,
          resourceType: rawResourceType,
          label,
          path
        }
  } catch {
    return { type: 'invalid', href, reason: 'parse_failed' }
  }
}

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

export const normalizeNcuratorRefMarkdownLinks = (markdown: string): string => {
  let output = ''
  let cursor = 0

  while (cursor < markdown.length) {
    const linkTextStart = markdown.indexOf('[', cursor)
    if (linkTextStart === -1) {
      output += markdown.slice(cursor)
      break
    }

    output += markdown.slice(cursor, linkTextStart)
    const linkTextEnd = findMarkdownLinkTextEnd(markdown, linkTextStart)
    const destinationStart = linkTextEnd + 2
    if (
      linkTextEnd === -1 ||
      markdown[linkTextEnd + 1] !== '(' ||
      !markdown.startsWith(REF_PREFIX, destinationStart)
    ) {
      output += markdown[linkTextStart]
      cursor = linkTextStart + 1
      continue
    }

    const destinationEnd = findMarkdownDestinationEnd(markdown, destinationStart)
    if (destinationEnd === -1) {
      output += markdown.slice(linkTextStart)
      break
    }

    const destination = markdown.slice(destinationStart, destinationEnd)
    const parsed = parseNcuratorRefHref(destination)
    output +=
      parsed.type === 'reference'
        ? parsed.kind === 'reference'
          ? buildNcuratorRefMarkdown({
              kind: parsed.kind,
              resourceType: parsed.resourceType,
              accessStatus: parsed.accessStatus,
              label: parsed.label,
              path: parsed.path
            })
          : buildNcuratorRefMarkdown({
              kind: parsed.kind,
              resourceType: parsed.resourceType,
              label: parsed.label,
              path: parsed.path
            })
        : markdown.slice(linkTextStart, destinationEnd + 1)
    cursor = destinationEnd + 1
  }

  return output
}

export const repairInlineCodeWrappedNcuratorLinks = (markdown: string): string =>
  markdown.replace(/`(\[[^\n`]+\]\((ncurator:\/\/ref\?[^\n`]+)\))`/g, (match, link, href) =>
    parseNcuratorRefHref(href).type === 'reference' ? link : match
  )
