import { resolveMarkdownEditorLinkTarget } from '../../../../shared/markdownEditorLink'

export type MarkdownEditorLinkOpenResult =
  | { ok: true; kind: 'web' | 'file'; target: string }
  | { ok: false; reason: 'empty' | 'unsupported' | 'missing' | 'open_failed'; detail?: string }

const readHrefFromVditorLinkElement = (element: Element): string => {
  if (element instanceof HTMLAnchorElement) {
    return (element.getAttribute('href') || '').trim()
  }
  return (element.textContent || '').trim()
}

export const openMarkdownEditorLink = async (input: {
  element: Element
  markdownFilePath: string
}): Promise<MarkdownEditorLinkOpenResult> => {
  const href = readHrefFromVditorLinkElement(input.element)
  if (!href) return { ok: false, reason: 'empty' }

  const target = resolveMarkdownEditorLinkTarget(input.markdownFilePath, href)
  if (!target) return { ok: false, reason: 'unsupported' }

  if (target.kind === 'web') {
    const response = await window.api.openExternal(target.url)
    if (!response.success) {
      return { ok: false, reason: 'open_failed', detail: response.error }
    }
    return { ok: true, kind: 'web', target: target.url }
  }

  const exists = await window.api.fileExists(target.path)
  if (!exists) return { ok: false, reason: 'missing' }

  const response = await window.api.openPath(target.path)
  if (!response.success) {
    return { ok: false, reason: 'open_failed', detail: response.error }
  }
  return { ok: true, kind: 'file', target: target.path }
}
