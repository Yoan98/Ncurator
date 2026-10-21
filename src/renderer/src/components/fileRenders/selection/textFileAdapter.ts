import { t } from '../../../i18n'
import type { SelectionLocation } from '../../workbench/composer/DocumentSelectionContext'
import { fromMarkdown } from 'mdast-util-from-markdown'
import {
  gfmNoAutolinkFromMarkdown,
  gfmNoAutolinkMicromarkExtension
} from '../../../../../shared/markdown/remarkGfmNoAutolink'
type MarkdownNode = {
  type: string
  value?: string
  children?: MarkdownNode[]
  position?: { start: { offset?: number }; end: { offset?: number } }
}
import type { DocumentSelectionNode } from '../../../../../shared/types'
import { createTextAdapter } from './textAdapter'
import { captureSelection, locateSelection, rangeForLocation, readPreviewText } from './textIndex'
import { newSelection, type SelectionAdapter } from './types'

const lineAt = (text: string, offset: number) => text.slice(0, offset).split('\n').length
export function sourceAnchor(
  source: string,
  start: number,
  end: number
): DocumentSelectionNode['anchor'] {
  return {
    kind: 'text',
    start,
    end,
    startLine: lineAt(source, start),
    endLine: lineAt(source, Math.max(start, end - 1)),
    sourceText: source.slice(start, end)
  }
}

/** AST source spans map formatted text back to Markdown, without rewriting the editor DOM. */
function markdownSourceRange(
  source: string,
  selected: string,
  before: string,
  after: string,
  location: SelectionLocation
): { start: number; end: number } {
  let visible = ''
  const positions: { start: number; end: number }[] = []
  const append = (value: string, start: number, end: number) => {
    const raw = source.slice(start, end)
    const exact = raw.indexOf(value)
    for (let i = 0; i < value.length; i++) {
      visible += value[i]
      positions.push(
        exact >= 0 ? { start: start + exact + i, end: start + exact + i + 1 } : { start, end }
      )
    }
  }
  const walk = (node: MarkdownNode) => {
    const start = node.position?.start.offset,
      end = node.position?.end.offset
    if (
      'value' in node &&
      typeof node.value === 'string' &&
      start !== undefined &&
      end !== undefined
    )
      append(node.value, start, end)
    else if (node.children) {
      for (const child of node.children) walk(child)
      if (['paragraph', 'heading', 'listItem', 'code', 'tableCell'].includes(node.type)) {
        visible += '\n'
        positions.push({ start: end || 0, end: end || 0 })
      }
    }
  }
  walk(
    fromMarkdown(source, {
      extensions: [gfmNoAutolinkMicromarkExtension],
      mdastExtensions: [gfmNoAutolinkFromMarkdown]
    })
  )
  // Browser rendering can collapse whitespace, but source positions address the normalized editor source.
  const compact = (text: string) => text.replace(/\s/g, '')
  const search = compact(selected)
  const projected = [...visible].join('')
  const indices: number[] = []
  let normalized = ''
  for (let i = 0; i < projected.length; i++)
    if (!/\s/.test(projected[i])) {
      indices.push(i)
      normalized += projected[i]
    }
  const matches: { start: number; end: number; score: number }[] = []
  const aligned = normalized === compact(location.previewText)
  const selectedOffset = compact(location.previewText.slice(0, location.start)).length
  for (let from = 0; search && from <= normalized.length; ) {
    const index = normalized.indexOf(search, from)
    if (index < 0) break
    const preceding = compact(before).slice(-50),
      following = compact(after).slice(0, 50)
    matches.push({
      start: positions[indices[index]].start,
      end: positions[indices[index + search.length - 1]].end,
      score:
        Number(aligned && index === selectedOffset) * 4 +
        Number(!!preceding && normalized.slice(0, index).endsWith(preceding)) +
        Number(!!following && normalized.slice(index + search.length).startsWith(following))
    })
    from = index + 1
  }
  matches.sort((a, b) => b.score - a.score)
  if (!matches.length)
    throw new Error(t(($) => $.editors.couldNotMapTheSelectionToTheMarkdownSource))
  if (matches.length > 1 && matches[0].score === matches[1].score)
    throw new Error(t(($) => $.editors.theSourceTextIsNotUniqueCouldNotReference))
  return matches[0]
}

export function markdownAdapter(
  container: HTMLElement,
  filePath: string,
  getSource: () => string
): SelectionAdapter {
  return createTextAdapter(container, filePath, {
    root: () => container.querySelector<HTMLElement>('.vditor-ir') || container,
    accepts: (node) => node.anchor?.kind === 'text',
    ignore: (element) => {
      // IR keeps syntax markers and an alternate code rendering in its DOM even when collapsed.
      const expanded = !!element.closest('.vditor-ir__node--expand')
      if (element.matches('.vditor-ir__marker--pre')) return !expanded
      if (element.matches('.vditor-ir__marker')) return true
      if (element.matches('.vditor-ir__preview')) return expanded
      return false
    },
    decorate: (node, location) => {
      const source = getSource()
      // Exact source match is also useful for visible IR markers and fenced code.
      const index = source.indexOf(node.selectedText)
      const mapped =
        index >= 0 && source.indexOf(node.selectedText, index + 1) < 0
          ? { start: index, end: index + node.selectedText.length }
          : markdownSourceRange(
              source,
              node.selectedText,
              node.contextBefore,
              node.contextAfter,
              location
            )
      node.anchor = sourceAnchor(source, mapped.start, mapped.end)
    }
  })
}

export function plainTextAdapter(
  textarea: HTMLTextAreaElement,
  mirror: HTMLElement,
  filePath: string
): SelectionAdapter {
  const geometry = (node: DocumentSelectionNode, saved?: SelectionLocation) => {
    const preview = readPreviewText(mirror)
    const a = node.anchor
    if (a?.kind !== 'text') return null
    const location = locateSelection(preview, node, saved)
    const range = location && rangeForLocation(preview, location)
    if (!range || !location) return null
    return {
      ranges: [range],
      rects: () => [...range.getClientRects()],
      reveal: () => {
        const rect = range.getBoundingClientRect(),
          viewport = textarea.getBoundingClientRect()
        textarea.scrollTop += rect.top - viewport.top - viewport.height / 2
        textarea.dispatchEvent(new Event('scroll'))
      },
      select: () => {
        textarea.focus()
        textarea.setSelectionRange(location.start, location.end)
      }
    }
  }
  return {
    capture: () => {
      if (document.activeElement !== textarea || textarea.selectionStart === textarea.selectionEnd)
        return null
      const start = textarea.selectionStart,
        end = textarea.selectionEnd,
        source = textarea.value
      const node = newSelection(filePath, source.slice(start, end))
      if (!node.selectedText.trim())
        throw new Error(t(($) => $.editors.theSelectionContainsNoReadableText))
      node.contextBefore = Array.from(source.slice(0, start)).slice(-150).join('')
      node.contextAfter = Array.from(source.slice(end)).slice(0, 150).join('')
      node.anchor = sourceAnchor(source, start, end)
      return { node, location: { start, end, previewText: source } }
    },
    locate: geometry,
    overlaps: (node, candidate, saved) => {
      const old = geometry(node, saved),
        fresh = geometry(candidate.node, candidate.location)
      if (!old || !fresh) return false
      const preview = readPreviewText(mirror)
      const a = captureSelection(mirror, preview, old.ranges[0]),
        b = captureSelection(mirror, preview, fresh.ranges[0])
      return !!a && !!b && a.start < b.end && b.start < a.end
    }
  }
}
