import { t } from '../../../i18n'
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { App } from 'antd'
import { createPortal } from 'react-dom'
import { hasUserText } from '../../../../../shared/chatContent'
import { DocumentSelectionContext } from '../../workbench/composer/DocumentSelectionContext'
import {
  positionSelectionFloating,
  previewViewport,
  type SelectionFloatingPosition,
  type SelectionRect
} from './floatingLayout'
import SelectionPopover from './SelectionPopover'
import {
  POINTER_CLICK_THRESHOLD,
  type SelectionAdapter,
  type SelectionCandidate,
  type SelectionPopup,
  type SelectionTarget
} from './types'

export default function DocumentSelectionLayer({
  container,
  filePath,
  adapter,
  revision,
  testPrefix = 'document',
  manageCursor = true,
  onTargetsChange
}: {
  container: HTMLElement | null
  filePath: string
  adapter: SelectionAdapter
  revision: string | number
  testPrefix?: string
  manageCursor?: boolean
  onTargetsChange?: (targets: SelectionTarget[]) => void
}) {
  const state = useContext(DocumentSelectionContext)
  const { message } = App.useApp()
  const [popup, setPopup] = useState<SelectionPopup | null>(null)
  const [floating, setFloating] = useState<SelectionFloatingPosition | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [boxes, setBoxes] = useState<(SelectionRect & { outline: boolean })[]>([])
  const popupRef = useRef<HTMLDivElement>(null)
  const targets = useRef<SelectionTarget[]>([])
  const handledNavigation = useRef<number | null>(null)
  const latest = useRef({ state, adapter, popup })
  useLayoutEffect(() => {
    latest.current = { state, adapter, popup }
  }, [state, adapter, popup])
  const noticeKey = `${testPrefix}-selection`
  const open = useCallback(
    (candidate: SelectionCandidate, mode: SelectionPopup['mode']) => {
      message.destroy(noticeKey)
      setHoveredId(null)
      setFloating(null)
      setPopup({ ...candidate, mode })
    },
    [message, noticeKey]
  )

  useEffect(() => {
    if (!container || !state?.enabled || !revision) return
    let start: { x: number; y: number } | null = null
    let clicked: SelectionTarget | undefined
    let pointer: PointerEvent | null = null
    const hit = (event: PointerEvent) =>
      targets.current.find(
        (target) =>
          latest.current.adapter.hitTest?.(target.node, event) ??
          target.geometry
            .rects()
            .some(
              (rect) =>
                event.clientX >= rect.left &&
                event.clientX < rect.right &&
                event.clientY >= rect.top &&
                event.clientY < rect.bottom
            )
      )
    const hover = (target?: SelectionTarget) => {
      if (manageCursor) container.toggleAttribute('data-document-selection-hover', Boolean(target))
      setHoveredId(target?.node.id || null)
    }
    const capture = (event: PointerEvent | KeyboardEvent) => {
      const current = latest.current
      if (current.state?.locked) return
      try {
        const candidate = current.adapter.capture(event)
        if (!candidate) return
        const nodes = current.state?.selections.filter((n) => n.filePath === filePath) || []
        if (
          nodes.some((n) =>
            current.adapter.overlaps(n, candidate, current.state?.locations.get(n.id))
          )
        ) {
          setPopup(null)
          return
        }
        open(candidate, 'action')
      } catch (error) {
        setPopup(null)
        void message.warning({
          key: noticeKey,
          content:
            error instanceof Error
              ? error.message
              : t(($) => $.editors.couldNotReferenceTheSelection)
        })
      }
    }
    const down = (e: PointerEvent) => {
      pointer = null
      clicked = undefined
      start = e.button === 0 ? { x: e.clientX, y: e.clientY } : null
      hover()
    }
    const up = (e: PointerEvent) => {
      if (e.button !== 0) return
      if (latest.current.adapter.acceptPointer?.(e) === false) {
        start = null
        clicked = undefined
        return
      }
      clicked =
        start &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        Math.hypot(e.clientX - start.x, e.clientY - start.y) <= POINTER_CLICK_THRESHOLD
          ? hit(e)
          : undefined
      start = null
      capture(e)
    }
    const click = (e: MouseEvent) => {
      const target = clicked
      clicked = undefined
      if (target && e.detail === 1 && !latest.current.state?.locked) open(target, 'editor')
    }
    const move = (e: PointerEvent) => {
      pointer = e.buttons ? null : e
      hover(pointer && !latest.current.state?.locked ? hit(pointer) : undefined)
    }
    const leave = () => {
      start = null
      clicked = undefined
      pointer = null
      hover()
    }
    const scroll = () => {
      start = null
      clicked = undefined
      // A queued scroll can follow mousemove; keep hover consistent with the new geometry.
      hover(pointer && !latest.current.state?.locked ? hit(pointer) : undefined)
    }
    const key = (e: KeyboardEvent) => {
      if (
        (['Enter', ' '].includes(e.key) &&
          e.target instanceof Element &&
          !!e.target.closest('[data-selection-trigger]')) ||
        e.shiftKey ||
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') ||
        e.key === 'Shift' ||
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)
      )
        capture(e)
    }
    container.addEventListener('pointerdown', down)
    container.addEventListener('pointerup', up)
    container.addEventListener('pointercancel', leave)
    container.addEventListener('click', click)
    container.addEventListener('pointermove', move)
    container.addEventListener('pointerleave', leave)
    container.addEventListener('keyup', key)
    document.addEventListener('scroll', scroll, true)
    window.addEventListener('blur', leave)
    return () => {
      container.removeEventListener('pointerdown', down)
      container.removeEventListener('pointerup', up)
      container.removeEventListener('pointercancel', leave)
      container.removeEventListener('click', click)
      container.removeEventListener('pointermove', move)
      container.removeEventListener('pointerleave', leave)
      container.removeEventListener('keyup', key)
      document.removeEventListener('scroll', scroll, true)
      window.removeEventListener('blur', leave)
      if (manageCursor) container.removeAttribute('data-document-selection-hover')
    }
  }, [container, filePath, state?.enabled, revision, open, message, noticeKey, manageCursor])

  useLayoutEffect(() => () => onTargetsChange?.([]), [onTargetsChange])

  useLayoutEffect(() => {
    if (!container || !state?.enabled || !revision) {
      targets.current = []
      onTargetsChange?.([])
      return
    }
    const key = `${testPrefix}-${crypto.randomUUID()}`
    const style = document.createElement('style')
    const opacity = adapter.highlightOpacity ?? 1
    const surface = `[data-document-selection-surface="${key}"]`
    container.setAttribute('data-document-selection-surface', key)
    style.textContent = `${surface}::selection,${surface} ::selection{background-color:rgb(219 197 246 / ${opacity});color:inherit}::highlight(${key}){background-color:rgb(233 221 251 / ${opacity})}::highlight(${key}-active),::highlight(${key}-hover){background-color:rgb(219 197 246 / ${opacity})}`
    document.head.appendChild(style)
    let frame = 0
    let unpaint: (() => void) | undefined
    const update = () => {
      const current = latest.current
      const nodes = current.state?.selections.filter((n) => n.filePath === filePath) || []
      targets.current = nodes.flatMap((node) => {
        const location = current.state?.locations.get(node.id)
        const geometry = current.adapter.locate(node, location)
        return geometry ? [{ node, location, geometry }] : []
      })
      onTargetsChange?.(targets.current)
      const active =
        current.popup && current.adapter.locate(current.popup.node, current.popup.location)
      const hovered = targets.current.find((t) => t.node.id === hoveredId)
      CSS.highlights.set(
        key,
        new Highlight(...targets.current.flatMap((t) => t.geometry.ranges || []))
      )
      const activeHighlight = new Highlight(...(active?.ranges || []))
      activeHighlight.priority = 2
      CSS.highlights.set(key + '-active', activeHighlight)
      const hoverHighlight = new Highlight(...(hovered?.geometry.ranges || []))
      hoverHighlight.priority = 1
      CSS.highlights.set(key + '-hover', hoverHighlight)
      const viewport = previewViewport(container)
      const position =
        active && popupRef.current
          ? positionSelectionFloating(
              active.rects(),
              viewport,
              popupRef.current.getBoundingClientRect()
            )
          : null
      setFloating((p) =>
        p?.left === position?.left &&
        p?.top === position?.top &&
        p?.placement === position?.placement
          ? p
          : position
      )
      unpaint?.()
      unpaint = current.adapter.paint?.(nodes, current.popup?.node, hoveredId)
      const nextBoxes = current.adapter.paint
        ? []
        : [
            ...targets.current.map((t) => t.geometry),
            ...(active ? [active] : []),
            ...(hovered && hovered.node.id !== current.popup?.node.id ? [hovered.geometry] : [])
          ]
            .filter((g) => !g.ranges?.length)
            .flatMap((g) => g.rects().map((rect) => ({ rect, outline: g.outline !== false })))
            .map(({ rect: r, outline }) => {
              const left = Math.max(r.left, viewport.left),
                top = Math.max(r.top, viewport.top)
              const right = Math.min(r.right, viewport.right),
                bottom = Math.min(r.bottom, viewport.bottom)
              return {
                left,
                top,
                right,
                bottom,
                width: right - left,
                height: bottom - top,
                outline
              }
            })
            .filter((r) => r.width > 0 && r.height > 0)
      setBoxes((p) => (JSON.stringify(p) === JSON.stringify(nextBoxes) ? p : nextBoxes))
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    update()
    const observer = new ResizeObserver(schedule)
    observer.observe(container)
    if (popupRef.current) observer.observe(popupRef.current)
    const mutations = new MutationObserver(schedule)
    mutations.observe(container, { childList: true, subtree: true, characterData: true })
    const unsubscribe = adapter.subscribe?.(schedule)
    document.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    container.addEventListener('wheel', schedule)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      mutations.disconnect()
      unsubscribe?.()
      unpaint?.()
      document.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      container.removeEventListener('wheel', schedule)
      CSS.highlights.delete(key)
      CSS.highlights.delete(key + '-active')
      CSS.highlights.delete(key + '-hover')
      if (container.getAttribute('data-document-selection-surface') === key)
        container.removeAttribute('data-document-selection-surface')
      style.remove()
    }
  }, [
    container,
    adapter,
    filePath,
    revision,
    state?.enabled,
    state?.selections,
    state?.locations,
    state?.locked,
    popup,
    hoveredId,
    testPrefix,
    onTargetsChange
  ])

  useEffect(() => {
    if (!container || !revision || state?.navigation?.node.filePath !== filePath) return
    if (handledNavigation.current === state.navigation.requestId) return
    const node = state.navigation.node
    if (adapter.navigate?.(node)) return
    handledNavigation.current = state.navigation.requestId
    const geometry = adapter.locate(node, state.locations.get(node.id))
    if (!geometry) {
      void message.warning({
        key: noticeKey,
        content: t(($) => $.editors.theTextHasChangedOrIsNotUniqueCould)
      })
      return
    }
    geometry.reveal()
    if (geometry.select) geometry.select()
    else if (geometry.ranges?.length) {
      const selected = window.getSelection()
      selected?.removeAllRanges()
      selected?.addRange(geometry.ranges[0])
    }
  }, [
    container,
    adapter,
    filePath,
    revision,
    state?.navigation,
    state?.locations,
    message,
    noticeKey
  ])

  const popupId = popup?.node.id
  const popupMode = popup?.mode
  useEffect(() => {
    if (!popupId) return
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Node && !popupRef.current?.contains(e.target)) setPopup(null)
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) setPopup(null)
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    if (popupMode === 'editor')
      popupRef.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus()
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [popupId, popupMode])
  useEffect(() => {
    setPopup(null)
    setHoveredId(null)
    setBoxes([])
    message.destroy(noticeKey)
  }, [filePath, revision, state?.enabled, state?.partnerId, noticeKey, message])

  if (!state?.enabled || !container) return null
  const save = () => {
    if (!popup || state.locked || !hasUserText(popup.node.children)) return
    try {
      state.save(popup.node, popup.location)
      setPopup(null)
    } catch (e) {
      void message.warning({
        key: noticeKey,
        content: e instanceof Error ? e.message : t(($) => $.editors.couldNotSaveTheReference)
      })
    }
  }
  return (
    <>
      {state.selections
        .filter((n) => n.filePath === filePath)
        .map((node) => (
          <button
            key={node.id}
            type="button"
            aria-label={t(($) => $.preferences.selectionEdit) + node.selectedText}
            disabled={state.locked}
            className="sr-only focus:not-sr-only focus:absolute focus:bottom-3 focus:left-3 focus:z-10 focus:bg-white"
            onFocus={() => targets.current.find((t) => t.node.id === node.id)?.geometry.reveal()}
            onClick={() => {
              const t = targets.current.find((t) => t.node.id === node.id)
              if (t) open(t, 'editor')
            }}
          >
            {t(($) => $.editors.viewReferencedContent)}
          </button>
        ))}
      {createPortal(
        boxes.map((box, index) => (
          <div
            key={index}
            data-testid="document-selection-highlight"
            className={
              'pointer-events-none fixed z-[40] bg-[#E9DDFB]/30' +
              (box.outline ? ' border border-[#B990DF]' : '')
            }
            style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
          />
        )),
        document.body
      )}
      {popup && (
        <SelectionPopover
          popup={popup}
          setPopup={setPopup}
          popupRef={popupRef}
          floating={floating}
          locked={state.locked}
          save={save}
          remove={state.remove}
          maxWidth={Math.max(0, container.clientWidth - 16)}
          testPrefix={testPrefix}
        />
      )}
    </>
  )
}
