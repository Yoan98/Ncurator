import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { App as AntdApp } from 'antd'
import { createPortal } from 'react-dom'
import { HiOutlineCheck, HiOutlineSparkles, HiOutlineTrash } from 'react-icons/hi2'
import type { ChatInlineContentNode, DocumentSelectionNode } from '../../../../shared/types'
import { chatContentText, chatReferences, hasUserText } from '../../../../shared/chatContent'
import {
  DocumentSelectionContext,
  type SelectionLocation
} from '../workbench/composer/DocumentSelectionContext'
import ComposerInputEditor from '../workbench/composer/ComposerInputEditor'
import {
  captureSelection,
  locateSelection,
  rangeForLocation,
  readPreviewText,
  textRangesForLocation
} from './docxSelectionText'
import {
  positionSelectionFloating,
  previewViewport,
  type SelectionFloatingPosition
} from './docxSelectionLayout'

type Popup = {
  node: DocumentSelectionNode
  location: SelectionLocation
  mode: 'action' | 'editor'
}
type SelectionTarget = {
  node: DocumentSelectionNode
  location: SelectionLocation
  range: Range
  textRanges: Range[]
}

export default function DocxSelectionLayer({
  container,
  filePath,
  revision
}: {
  container: HTMLDivElement | null
  filePath: string
  revision: number
}) {
  const state = useContext(DocumentSelectionContext)
  const { message } = AntdApp.useApp()
  const [popup, setPopup] = useState<Popup | null>(null)
  const [floating, setFloating] = useState<SelectionFloatingPosition | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const latestRef = useRef(state)
  const targetsRef = useRef<SelectionTarget[]>([])
  const popupId = popup?.node.id
  const popupMode = popup?.mode
  const popupLocation = popup?.location
  useEffect(() => {
    latestRef.current = state
  }, [state])
  const open = useCallback(
    (node: DocumentSelectionNode, location: SelectionLocation, mode: Popup['mode']): void => {
      message.destroy('docx-selection')
      setHoveredId(null)
      setFloating(null)
      setPopup({ node, location, mode })
      window.getSelection()?.removeAllRanges()
    },
    [message]
  )

  useEffect(() => {
    if (!container || !state?.enabled || !revision) return
    const cursor = container.style.cursor
    let pointerDown: { x: number; y: number } | null = null
    let clickedTarget: SelectionTarget | undefined
    const hit = (event: PointerEvent): SelectionTarget | undefined =>
      targetsRef.current.find((target) =>
        target.textRanges.some((range) =>
          [...range.getClientRects()].some(
            (rect) =>
              event.clientX >= rect.left &&
              event.clientX < rect.right &&
              event.clientY >= rect.top &&
              event.clientY < rect.bottom
          )
        )
      )
    const hover = (target?: SelectionTarget): void => {
      container.style.cursor = target ? 'pointer' : cursor
      setHoveredId(target?.node.id || null)
    }
    const capture = (): boolean => {
      if (latestRef.current?.locked) return false
      const selection = window.getSelection()
      if (!selection?.rangeCount || selection.isCollapsed) return false
      const range = selection.getRangeAt(0)
      if (!container.contains(range.commonAncestorContainer)) return false
      const preview = readPreviewText(container)
      const location = captureSelection(container, preview, range)
      if (!location) {
        setPopup(null)
        void message.warning({ key: 'docx-selection', content: '当前选区没有可读取的文字。' })
        return true
      }
      const nodes = latestRef.current?.selections.filter((node) => node.filePath === filePath) || []
      for (const node of nodes) {
        const existing = locateSelection(preview, node, latestRef.current?.locations.get(node.id))
        if (!existing) continue
        if (existing.start < location.end && location.start < existing.end) {
          message.destroy('docx-selection')
          setPopup(null)
          return true
        }
      }
      open(
        {
          kind: 'document_selection',
          id: crypto.randomUUID(),
          number: 0,
          filePath,
          selectedText: preview.text.slice(location.start, location.end),
          contextBefore: Array.from(preview.text.slice(0, location.start)).slice(-150).join(''),
          contextAfter: Array.from(preview.text.slice(location.end)).slice(0, 150).join(''),
          children: []
        },
        location,
        'action'
      )
      return true
    }
    const onPointerDown = (event: PointerEvent): void => {
      clickedTarget = undefined
      pointerDown = event.button === 0 ? { x: event.clientX, y: event.clientY } : null
      hover()
    }
    const onPointerUp = (event: PointerEvent): void => {
      const start = pointerDown
      pointerDown = null
      clickedTarget =
        start &&
        event.button === 0 &&
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 4
          ? hit(event)
          : undefined
      capture()
    }
    const onClick = (event: MouseEvent): void => {
      const target = clickedTarget
      clickedTarget = undefined
      // A click within native selected text may collapse that selection only after pointerup.
      if (target && event.detail === 1 && !latestRef.current?.locked)
        open(target.node, target.location, 'editor')
    }
    const onPointerMove = (event: PointerEvent): void => {
      hover(!event.buttons && !latestRef.current?.locked ? hit(event) : undefined)
    }
    const onPointerLeave = (): void => {
      pointerDown = null
      clickedTarget = undefined
      hover()
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.shiftKey || event.key === 'Shift') capture()
    }
    container.addEventListener('pointerdown', onPointerDown)
    container.addEventListener('pointerup', onPointerUp)
    container.addEventListener('pointermove', onPointerMove)
    container.addEventListener('pointerleave', onPointerLeave)
    container.addEventListener('click', onClick)
    document.addEventListener('scroll', onPointerLeave, true)
    window.addEventListener('resize', onPointerLeave)
    container.addEventListener('keyup', onKeyUp)
    return () => {
      container.removeEventListener('pointerdown', onPointerDown)
      container.removeEventListener('pointerup', onPointerUp)
      container.removeEventListener('pointermove', onPointerMove)
      container.removeEventListener('pointerleave', onPointerLeave)
      container.removeEventListener('click', onClick)
      document.removeEventListener('scroll', onPointerLeave, true)
      window.removeEventListener('resize', onPointerLeave)
      container.removeEventListener('keyup', onKeyUp)
      container.style.cursor = cursor
      setHoveredId(null)
    }
  }, [
    container,
    filePath,
    revision,
    state?.enabled,
    state?.locked,
    state?.selections,
    message,
    open
  ])

  useLayoutEffect(() => {
    if (!container || !revision || !state?.enabled) return
    const key = 'docx-' + crypto.randomUUID()
    const activeKey = key + '-active'
    const hoverKey = key + '-hover'
    const style = document.createElement('style')
    style.textContent =
      '::highlight(' +
      key +
      ') { background-color: #E9DDFB; }' +
      '::highlight(' +
      activeKey +
      '), ::highlight(' +
      hoverKey +
      ') { background-color: #DBC5F6; }'
    document.head.appendChild(style)
    let frame = 0
    const update = (): void => {
      const preview = readPreviewText(container)
      const viewport = previewViewport(container)
      const targets: SelectionTarget[] = []
      const nodes = state.selections.filter((node) => node.filePath === filePath)
      for (const node of nodes) {
        const location = locateSelection(preview, node, state.locations.get(node.id))
        const range = location && rangeForLocation(preview, location)
        if (!range || !location) continue
        targets.push({
          node,
          location,
          range,
          textRanges: textRangesForLocation(preview, location)
        })
      }
      targetsRef.current = targets
      CSS.highlights.set(key, new Highlight(...targets.map((target) => target.range)))
      const hovered = targets.find((target) => target.node.id === hoveredId)
      const hoverHighlight = new Highlight(...(hovered && !state.locked ? [hovered.range] : []))
      hoverHighlight.priority = 1
      CSS.highlights.set(hoverKey, hoverHighlight)

      const activeRange =
        popupLocation?.previewText === preview.text
          ? rangeForLocation(preview, popupLocation)
          : null
      const activeHighlight = new Highlight(...(activeRange ? [activeRange] : []))
      activeHighlight.priority = 2
      CSS.highlights.set(activeKey, activeHighlight)
      const position =
        activeRange && popupRef.current
          ? positionSelectionFloating(
              activeRange,
              viewport,
              popupRef.current.getBoundingClientRect()
            )
          : null
      setFloating((previous) =>
        previous?.left === position?.left &&
        previous?.top === position?.top &&
        previous?.placement === position?.placement
          ? previous
          : position
      )
    }
    const schedule = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    update()
    document.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    const observer = new ResizeObserver(schedule)
    observer.observe(container)
    if (popupRef.current) observer.observe(popupRef.current)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      observer.disconnect()
      CSS.highlights.delete(key)
      CSS.highlights.delete(activeKey)
      CSS.highlights.delete(hoverKey)
      targetsRef.current = []
      style.remove()
    }
  }, [
    container,
    revision,
    filePath,
    state?.enabled,
    state?.selections,
    state?.locations,
    state?.locked,
    hoveredId,
    popupLocation,
    popupMode
  ])

  useEffect(() => {
    if (!container || !revision || state?.navigation?.node.filePath !== filePath) return
    const node = state.navigation.node
    const preview = readPreviewText(container)
    const location = locateSelection(preview, node, state.locations.get(node.id))
    const range = location && rangeForLocation(preview, location)
    if (!range || !location) {
      void message.warning({
        key: 'docx-selection',
        content: '原文已变化或位置不唯一，无法定位该选区。'
      })
      return
    }
    range.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'instant' })
    const selected = window.getSelection()
    selected?.removeAllRanges()
    selected?.addRange(range)
  }, [container, revision, filePath, state?.navigation, state?.locations, message])

  useEffect(() => {
    if (!popupId) return
    const outside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !popupRef.current?.contains(event.target)) setPopup(null)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) setPopup(null)
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
    message.destroy('docx-selection')
    setHoveredId(null)
  }, [filePath, revision, state?.enabled, message])

  if (!state?.enabled) return null
  const save = (): void => {
    if (!popup || state.locked || !hasUserText(popup.node.children)) return
    state.save(popup.node, popup.location)
    setPopup(null)
    window.getSelection()?.removeAllRanges()
  }
  return (
    <>
      {state.selections
        .filter((node) => node.filePath === filePath)
        .map((node) => (
          <button
            key={node.id}
            type="button"
            aria-label={'编辑所选内容：' + node.selectedText}
            disabled={state.locked}
            className="sr-only absolute z-10 cursor-pointer rounded-md bg-white text-sm text-[#79569F] outline-none focus:not-sr-only focus:absolute focus:bottom-3 focus:left-3 focus:px-3 focus:py-2 focus-visible:ring-2 focus-visible:ring-[#0B6BCB]"
            onFocus={() => {
              const target = targetsRef.current.find((target) => target.node.id === node.id)
              target?.range.startContainer.parentElement?.scrollIntoView({
                block: 'center',
                behavior: 'instant'
              })
            }}
            onClick={() => {
              const target = targetsRef.current.find((target) => target.node.id === node.id)
              if (target) open(target.node, target.location, 'editor')
            }}
          >
            查看引用内容
          </button>
        ))}
      {popup &&
        createPortal(
          <div
            ref={popupRef}
            data-testid="docx-selection-popup"
            data-placement={floating?.placement}
            className={
              'fixed z-[1100] border border-[#E0DFDC] bg-white shadow-[0_4px_16px_rgba(15,15,15,0.10)] ' +
              (popup.mode === 'editor'
                ? 'flex w-[420px] items-end gap-1 rounded-[19px] p-[4px] focus-within:border-[#B5CCE2]'
                : 'rounded-lg p-1')
            }
            style={{
              left: floating?.left,
              top: floating?.top,
              maxWidth: container ? Math.max(0, container.clientWidth - 16) : undefined,
              visibility: floating ? 'visible' : 'hidden'
            }}
          >
            {popup.mode === 'action' ? (
              <button
                type="button"
                data-testid="docx-selection-ai-reference"
                disabled={state.locked}
                className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-[#37352F] outline-none hover:bg-[#F4F4F2] focus-visible:ring-2 focus-visible:ring-[#0B6BCB] disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => setPopup((previous) => previous && { ...previous, mode: 'editor' })}
              >
                <HiOutlineSparkles className="h-4 w-4 text-[#80649F]" aria-hidden="true" />
                AI 引用
              </button>
            ) : (
              <>
                <ComposerInputEditor
                  value={{
                    contentNodes: popup.node.children,
                    input: chatContentText(popup.node.children).trim(),
                    selectedReferences: chatReferences(popup.node.children)
                  }}
                  variant="inline"
                  placeholder="描述你想对引用内容做什么"
                  dataTestId="docx-selection-thought"
                  disabled={state.locked}
                  onSubmit={save}
                  editorClassName="max-h-[68px] overflow-auto"
                  onChange={(value) =>
                    setPopup(
                      (previous) =>
                        previous && {
                          ...previous,
                          node: {
                            ...previous.node,
                            children: value.contentNodes.filter(
                              (node): node is ChatInlineContentNode =>
                                node.kind !== 'document_selection'
                            )
                          }
                        }
                    )
                  }
                />
                {popup.node.number ? (
                  <button
                    type="button"
                    aria-label="删除引用"
                    title="删除引用"
                    disabled={state.locked}
                    className="flex h-[28px] w-[28px] shrink-0 cursor-pointer items-center justify-center rounded-full text-[#91918E] outline-none hover:bg-[#F8EBE9] hover:text-[#B3261E] focus-visible:ring-2 focus-visible:ring-[#0B6BCB] disabled:cursor-not-allowed"
                    onClick={() => {
                      state.remove(popup.node.id)
                      setPopup(null)
                    }}
                  >
                    <HiOutlineTrash className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                ) : null}
                <button
                  type="button"
                  data-testid="docx-selection-save"
                  aria-label={popup.node.number ? '确认修改' : '添加到输入框'}
                  title={popup.node.number ? '确认修改' : '添加到输入框'}
                  disabled={state.locked || !hasUserText(popup.node.children)}
                  className="flex h-[28px] w-[28px] shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#37352F] text-white outline-none hover:bg-[#25241F] focus-visible:ring-2 focus-visible:ring-[#0B6BCB] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[#F4F4F2] disabled:text-[#B8B7B3]"
                  onClick={save}
                >
                  <HiOutlineCheck className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </>
            )}
          </div>,
          document.body
        )}
    </>
  )
}
