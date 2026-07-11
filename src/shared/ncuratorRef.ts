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

export type ParsedNcuratorRef =
  | {
      type: 'reference'
      kind: NcuratorRefKind
      resourceType: NcuratorRefResourceType
      label: string
      path: string
    }
  | {
      type: 'normal'
      href?: string
    }

const REF_PREFIX = 'ncurator://ref?'

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

export const buildNcuratorRefMarkdown = (input: {
  label: string
  path: string
  resourceType: NcuratorRefResourceType
  kind: NcuratorRefKind
}): string => {
  const query = [
    `kind=${input.kind}`,
    `resourceType=${input.resourceType}`,
    `label=${encodeNcuratorRefValue(input.label)}`,
    `path=${encodeNcuratorRefValue(input.path)}`
  ].join('&')
  return `[${escapeMarkdownLinkText(input.label)}](${REF_PREFIX}${query})`
}

export const NCURATOR_REF_MARKDOWN_FORMAT_EXAMPLE = buildNcuratorRefMarkdown({
  label: '资料名称',
  path: '/workspace/资料.docx',
  resourceType: 'file',
  kind: 'reference'
})

export const parseNcuratorRefHref = (href?: string): ParsedNcuratorRef => {
  if (!href?.startsWith(REF_PREFIX)) {
    return { type: 'normal', href }
  }

  try {
    const params = new URLSearchParams(href.slice(REF_PREFIX.length))
    const rawKind = params.get('kind')
    const rawResourceType = params.get('resourceType')
    const path = params.get('path') || ''
    if (!path || (rawKind !== 'reference' && rawKind !== 'normal')) {
      return { type: 'normal', href }
    }
    const inferredResourceType: NcuratorRefResourceType = /^https?:\/\//i.test(path)
      ? 'web'
      : 'file'
    const resourceType: NcuratorRefResourceType =
      rawResourceType === 'file' || rawResourceType === 'web'
        ? rawResourceType
        : inferredResourceType
    const normalizedPath = path.replace(/\\/g, '/')
    const fallbackLabel = normalizedPath.split('/').filter(Boolean).pop() || normalizedPath || path
    const label = params.get('label') || fallbackLabel
    return {
      type: 'reference',
      kind: rawKind,
      resourceType,
      label,
      path
    }
  } catch {
    return { type: 'normal', href }
  }
}
