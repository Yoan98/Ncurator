import { classifyMarkdownHref } from './markdownLink'
import { dirnamePath, joinFsPath } from './markdownImagePath'

export type ResolvedMarkdownEditorLinkTarget =
  | { kind: 'web'; url: string }
  | { kind: 'file'; path: string }

export const resolveMarkdownEditorLinkTarget = (
  markdownFilePath: string,
  rawHref: string
): ResolvedMarkdownEditorLinkTarget | null => {
  const href = rawHref.trim()
  if (!href) return null

  const classified = classifyMarkdownHref(href)
  if (classified.type === 'web') return { kind: 'web', url: classified.url }
  if (classified.type === 'file') return { kind: 'file', path: classified.path }
  if (classified.type === 'unknown' && !href.includes('://')) {
    return { kind: 'file', path: joinFsPath(dirnamePath(markdownFilePath), href) }
  }
  return null
}
