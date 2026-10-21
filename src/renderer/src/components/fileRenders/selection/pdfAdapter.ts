import { t } from '../../../i18n'
import { createTextAdapter } from './textAdapter'
import { readPreviewText, captureSelection } from './textIndex'
import type { SelectionAdapter } from './types'

export function pdfAdapter(container: HTMLElement, filePath: string): SelectionAdapter {
  const text = createTextAdapter(container, filePath, {
    accepts: (node) => node.anchor?.kind === 'pdf',
    decorate: (node, _location, range) => {
      const start = range.startContainer.parentElement?.closest<HTMLElement>('[data-pdf-page]')
      const end = range.endContainer.parentElement?.closest<HTMLElement>('[data-pdf-page]')
      if (!start || !end)
        throw new Error(t(($) => $.editors.couldNotLocateThePdfPageContainingThisText))
      const offset = (page: HTMLElement, endpoint: Node, at: number) => {
        const prefix = window.document.createRange()
        prefix.selectNodeContents(page)
        prefix.setEnd(endpoint, at)
        return captureSelection(page, readPreviewText(page), prefix)?.end || 0
      }
      node.anchor = {
        kind: 'pdf',
        startPage: Number(start.dataset.pdfPage),
        endPage: Number(end.dataset.pdfPage),
        start: offset(start, range.startContainer, range.startOffset),
        end: offset(end, range.endContainer, range.endOffset)
      }
    }
  })
  let start: { x: number; y: number } | null = null
  return {
    ...text,
    highlightOpacity: 0.35,
    capture: (event) => {
      const candidate = text.capture(event)
      if (candidate) return candidate
      if (
        event instanceof PointerEvent &&
        start &&
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4 &&
        event.target instanceof Element
      ) {
        const page = event.target.closest('[data-pdf-page]')
        if (page && !page.querySelector('.textLayer')?.textContent?.trim())
          throw new Error(t(($) => $.editors.thisPageHasNoReadableTextScannedPagesAnd))
      }
      return null
    },
    subscribe: () => {
      const down = (event: PointerEvent) => {
        start = { x: event.clientX, y: event.clientY }
      }
      container.addEventListener('pointerdown', down)
      return () => container.removeEventListener('pointerdown', down)
    }
  }
}
