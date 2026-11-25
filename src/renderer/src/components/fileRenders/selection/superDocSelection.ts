import type { SelectionInfo, SuperDoc } from 'superdoc'
import { createTextAdapter } from './textAdapter'
import { POINTER_CLICK_THRESHOLD } from './types'

function paintedCaret(container: HTMLElement, event: PointerEvent): Range | null {
  const elements = document.elementsFromPoint(event.clientX, event.clientY)
  const page =
    elements.map((el) => el.closest<HTMLElement>('.superdoc-page')).find(Boolean) ??
    [...container.querySelectorAll<HTMLElement>('.superdoc-page')].find((p) => {
      const { left, right, top, bottom } = p.getBoundingClientRect()
      return (
        event.clientX >= left &&
        event.clientX <= right &&
        event.clientY >= top &&
        event.clientY <= bottom
      )
    })
  if (!page || !container.contains(page)) return null
  const caret = document.caretPositionFromPoint(event.clientX, event.clientY)
  const underPointer = (element: Element) => {
    const box = element.getBoundingClientRect()
    return (
      event.clientX >= box.left - 1 &&
      event.clientX <= box.right + 1 &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom
    )
  }
  if (
    caret?.offsetNode instanceof Text &&
    caret.offsetNode.parentElement?.closest('[data-run-id]') &&
    underPointer(caret.offsetNode.parentElement) &&
    page.contains(caret.offsetNode)
  ) {
    const range = document.createRange()
    range.setStart(caret.offsetNode, caret.offset)
    range.collapse(true)
    return range
  }
  const direct = elements.map((el) => el.closest<HTMLElement>('[data-run-id]')).find(Boolean)
  const candidates = direct ? [direct] : page.querySelectorAll<HTMLElement>('[data-run-id]')
  for (const run of candidates) {
    if (!underPointer(run)) continue
    const walker = document.createTreeWalker(run, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      const range = document.createRange()
      // Ask Chromium for glyph coordinates; this also respects CJK glyph widths and bidi runs.
      let best = 0,
        distance = Infinity
      for (let i = 0; i <= node.length; i++) {
        range.setStart(node, i)
        range.collapse(true)
        const delta = Math.abs(range.getBoundingClientRect().left - event.clientX)
        if (delta < distance) {
          best = i
          distance = delta
        }
      }
      range.setStart(node, best)
      range.collapse(true)
      return range
    }
  }
  return null
}

export function observeWordPointers(container: HTMLElement) {
  let anchor: Range | null = null
  let origin: { x: number; y: number } | undefined
  let generation = 0
  // The editor consumes inactive header/footer presses in the window capture phase.
  // Register before mounting it and observe the gesture without preventing editor input.
  const down = (event: PointerEvent) => {
    generation++
    if (
      !(event.target instanceof Node) ||
      !container.contains(event.target) ||
      event.button !== 0
    ) {
      origin = undefined
      anchor = null
      return
    }
    origin = { x: event.clientX, y: event.clientY }
    if (!event.shiftKey) anchor = paintedCaret(container, event)
  }
  const cancel = () => {
    generation++
  }
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') cancel()
  }
  window.addEventListener('pointerdown', down, true)
  window.addEventListener('keydown', key, true)
  window.addEventListener('blur', cancel)
  return {
    anchor: () => anchor,
    origin: () => origin,
    generation: () => generation,
    close: () => {
      cancel()
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', cancel)
    }
  }
}
export type WordPointers = ReturnType<typeof observeWordPointers>
export function createWordSelectionAdapter(
  container: HTMLElement,
  filePath: string,
  pointers?: WordPointers,
  editor?: SuperDoc
) {
  const text = createTextAdapter(container, filePath)
  return {
    ...text,
    pointerOrigin: pointers?.origin,
    async capture(event: PointerEvent | KeyboardEvent) {
      const anchor = pointers?.anchor()
      const generation = pointers?.generation()
      const current = () => pointers?.generation() === generation
      const origin = pointers?.origin()
      const dragged =
        event instanceof PointerEvent &&
        origin &&
        Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > POINTER_CLICK_THRESHOLD
      // Clicking the canvas margin dismisses the popup even if the SDK keeps its last selection.
      // A drag starting after the last glyph is still a valid reverse selection.
      if (event instanceof PointerEvent && !anchor && !event.shiftKey && !dragged) return null
      if (event instanceof PointerEvent && anchor) {
        const end = paintedCaret(container, event)
        const start = anchor
        if (end && !end.isPointInRange(start.startContainer, start.startOffset)) {
          const backwards = start.compareBoundaryPoints(Range.START_TO_START, end) > 0
          const [a, b] = backwards ? [end, start] : [start, end]
          const resolved = document.createRange()
          resolved.setStart(a.startContainer, a.startOffset)
          resolved.setEnd(b.startContainer, b.startOffset)
          return text.capture(event, resolved)
        }
        // A drag may finish in the whitespace after a shorter line. The editor still has
        // a valid text selection; only a plain click should dismiss it without capturing.
        if (!event.shiftKey && !dragged) return null
      }
      await new Promise(requestAnimationFrame)
      if (!current()) return null
      let selected: SelectionInfo | undefined
      try {
        selected = await editor?.activeEditor?.doc?.selection.current({ includeText: true })
      } catch (error) {
        if (!current()) return null
        throw error
      }
      if (!current()) return null
      if (!selected?.target || selected.empty) return text.capture(event)
      const segments = selected.target.segments
      const point = (blockId: string, offset: number) => {
        const blocks = container.querySelectorAll<HTMLElement>(
          '.superdoc-page [data-para-id="' + CSS.escape(blockId) + '"]'
        )
        for (const block of blocks)
          for (const el of block.querySelectorAll<HTMLElement>('[data-run-id]')) {
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
              const text = n as Text
              if (offset <= text.length) return { text, offset }
              offset -= text.length
            }
          }
        return null
      }
      if (!segments.length) return null
      const first = segments[0],
        last = segments.at(-1)!
      const start = point(first.blockId, first.range.start),
        end = point(last.blockId, last.range.end)
      if (!start || !end) return null
      const range = document.createRange()
      range.setStart(start.text, start.offset)
      range.setEnd(end.text, end.offset)
      return text.capture(event, range)
    }
  }
}
