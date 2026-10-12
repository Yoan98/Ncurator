import type { DocumentSelectionNode } from '../../../../../shared/types'
import { captureSelection, locateSelection, readPreviewText, svgTextRects } from './textIndex'
import type { PptViewerSlide } from '../PptSlideDeckViewer'
import { newSelection, type SelectionAdapter, type SelectionGeometry } from './types'

/** Only generated SVG primitives and embedded image data are needed by the preview. */
export function interactivePptSvg(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  doc.querySelectorAll('script, foreignObject').forEach((node) => node.remove())
  doc.querySelectorAll('[data-nc-shape-id]').forEach((node) => {
    // PPT tools expose top-level shapes; select a group by its outer shape ID.
    if (node.parentElement?.closest('[data-nc-shape-id]')) node.removeAttribute('data-nc-shape-id')
    else node.setAttribute('pointer-events', 'all')
  })
  for (const element of doc.querySelectorAll('*')) {
    for (const attr of [...element.attributes]) {
      if (
        /^on/i.test(attr.name) ||
        (attr.localName === 'href' &&
          !attr.value.startsWith('#') &&
          !/^data:image\//i.test(attr.value))
      )
        element.removeAttributeNode(attr)
    }
  }
  return new XMLSerializer().serializeToString(doc.documentElement)
}

export function pptAdapter(
  container: HTMLElement,
  filePath: string,
  slide: PptViewerSlide,
  revision: string,
  selectSlide: (id: string) => boolean,
  isPanning: () => boolean
): SelectionAdapter {
  const svg = () => container.querySelector<SVGSVGElement>('[data-ppt-interactive] svg')
  const elementFor = (node: DocumentSelectionNode): SVGGraphicsElement | null => {
    const a = node.anchor,
      root = svg()
    if (a?.kind !== 'ppt' || a.slideId !== slide.id || !root) return null
    return a.elementId
      ? root.querySelector<SVGGraphicsElement>(
          `[data-nc-shape-id="${CSS.escape(a.elementId.split('#').at(-1)!)}"]`
        )
      : root
  }
  const locate = (
    node: DocumentSelectionNode,
    saved?: { start: number; end: number; previewText: string }
  ): SelectionGeometry | null => {
    const a = node.anchor,
      element = elementFor(node)
    if (a?.kind !== 'ppt' || !element) return null
    if (a.mode === 'text') {
      const preview = readPreviewText(element)
      const location = locateSelection(preview, node, saved)
      if (!location) return null
      // SVG text highlight painting varies across Chromium versions; geometry is always reliable.
      return {
        rects: () => svgTextRects(preview, location),
        outline: false,
        reveal: () => element.scrollIntoView({ block: 'center', behavior: 'instant' })
      }
    }
    if (a.revision !== revision) return null
    return {
      rects: () => {
        if (!(element instanceof SVGSVGElement)) return [element.getBoundingClientRect()]
        const matrix = element.getScreenCTM()
        if (!matrix) return []
        const view = element.viewBox.baseVal
        const start = new DOMPoint(view.x, view.y).matrixTransform(matrix)
        const end = new DOMPoint(view.x + view.width, view.y + view.height).matrixTransform(matrix)
        return [new DOMRect(start.x, start.y, end.x - start.x, end.y - start.y)]
      },
      reveal: () => element.scrollIntoView({ block: 'center', behavior: 'instant' })
    }
  }
  return {
    capture: (event) => {
      const root = svg()
      if (!root) return null
      const whole =
        event.target instanceof Element && !!event.target.closest('[data-ppt-reference-page]')
      if (isPanning() && !whole) return null
      const selection = window.getSelection()
      if (
        !whole &&
        selection?.rangeCount &&
        !selection.isCollapsed &&
        root.contains(selection.getRangeAt(0).commonAncestorContainer)
      ) {
        const range = selection.getRangeAt(0)
        const first =
          range.startContainer.parentElement?.closest<SVGGraphicsElement>('[data-nc-shape-id]')
        const last = range.endContainer.parentElement?.closest('[data-nc-shape-id]')
        if (!first || first !== last) throw new Error('请在一个文本框内选择文字，或引用当前页。')
        const preview = readPreviewText(first)
        const location = captureSelection(first, preview, range)
        if (!location) throw new Error('当前选区没有可读取的文字。')
        const node = newSelection(filePath, preview.text.slice(location.start, location.end))
        node.contextBefore = Array.from(preview.text.slice(0, location.start)).slice(-150).join('')
        node.contextAfter = Array.from(preview.text.slice(location.end)).slice(0, 150).join('')
        node.anchor = {
          kind: 'ppt',
          slideId: slide.id,
          page: slide.index,
          elementId: `${slide.id}#${first.dataset.ncShapeId}`,
          mode: 'text',
          textRange: { start: location.start, end: location.end },
          revision
        }
        return { node, location }
      }
      if ((!whole && !(event instanceof PointerEvent)) || !(event.target instanceof Element))
        return null
      const element = whole ? root : event.target.closest<SVGGraphicsElement>('[data-nc-shape-id]')
      if (!element || !root.contains(element)) return null
      const node = newSelection(filePath, readPreviewText(element).text)
      node.anchor = {
        kind: 'ppt',
        slideId: slide.id,
        page: slide.index,
        elementId: whole ? undefined : `${slide.id}#${element.dataset.ncShapeId}`,
        mode: whole ? 'slide' : 'element',
        revision
      }
      return { node }
    },
    locate,
    overlaps: (node, candidate, saved) => {
      const a = node.anchor,
        b = candidate.node.anchor
      if (
        a?.kind !== 'ppt' ||
        b?.kind !== 'ppt' ||
        a.slideId !== b.slideId ||
        a.mode !== b.mode ||
        a.elementId !== b.elementId ||
        !locate(node, saved)
      )
        return false
      if (a.mode !== 'text') return true
      const root = elementFor(node)
      if (!root || !candidate.location) return false
      const old = locateSelection(readPreviewText(root), node, saved)
      return !!old && old.start < candidate.location.end && candidate.location.start < old.end
    },
    navigate: (node) => {
      if (node.anchor?.kind === 'ppt' && node.anchor.slideId !== slide.id) {
        return selectSlide(node.anchor.slideId)
      }
      return false
    },
    subscribe: (refresh) => {
      const observer = new MutationObserver(refresh)
      observer.observe(container, { subtree: true, attributes: true, attributeFilter: ['style'] })
      return () => observer.disconnect()
    }
  }
}
