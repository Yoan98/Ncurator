import type { DocumentSelectionNode } from '../../../../../shared/types'
import type { SelectionLocation } from '../../workbench/composer/DocumentSelectionContext'
import {
  captureSelection,
  locateSelection,
  rangeForLocation,
  readPreviewText,
  textRangesForLocation
} from './textIndex'
import { newSelection, type SelectionAdapter, type SelectionGeometry } from './types'

export function createTextAdapter(
  container: HTMLElement,
  filePath: string,
  options: {
    decorate?: (node: DocumentSelectionNode, location: SelectionLocation, range: Range) => void
    accepts?: (node: DocumentSelectionNode) => boolean
    root?: () => HTMLElement | SVGElement
    ignore?: (element: Element) => boolean
    navigate?: SelectionAdapter['navigate']
  } = {}
): SelectionAdapter {
  const root = () => options.root?.() || container
  const read = () => readPreviewText(root(), options.ignore)
  const locate = (node: DocumentSelectionNode, saved?: SelectionLocation) => {
    if (options.accepts && !options.accepts(node)) return null
    const preview = read()
    return locateSelection(preview, node, saved)
  }
  return {
    capture: () => {
      const selection = window.getSelection()
      if (!selection?.rangeCount || selection.isCollapsed) return null
      const range = selection.getRangeAt(0)
      const element = root()
      if (!element.contains(range.commonAncestorContainer)) return null
      const preview = read()
      const location = captureSelection(element, preview, range)
      if (!location) throw new Error('当前选区没有可读取的文字。')
      const node = newSelection(filePath, preview.text.slice(location.start, location.end))
      node.contextBefore = Array.from(preview.text.slice(0, location.start)).slice(-150).join('')
      node.contextAfter = Array.from(preview.text.slice(location.end)).slice(0, 150).join('')
      options.decorate?.(node, location, range)
      return { node, location }
    },
    locate: (node, saved): SelectionGeometry | null => {
      const location = locate(node, saved)
      if (!location) return null
      const preview = read()
      const range = rangeForLocation(preview, location)
      if (!range) return null
      const textRanges = textRangesForLocation(preview, location)
      return {
        ranges: [range],
        rects: () => textRanges.flatMap((r) => [...r.getClientRects()]),
        reveal: () =>
          range.startContainer.parentElement?.scrollIntoView({
            block: 'center',
            behavior: 'instant'
          })
      }
    },
    overlaps: (node, candidate, saved) => {
      if (!candidate.location) return false
      const old = locate(node, saved)
      return !!old && old.start < candidate.location.end && candidate.location.start < old.end
    },
    navigate: options.navigate
  }
}
