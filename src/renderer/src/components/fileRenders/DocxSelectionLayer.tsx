import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { HiOutlineCheck, HiOutlineSparkles, HiOutlineTrash } from 'react-icons/hi2'
import type { ChatInlineContentNode, DocumentSelectionNode } from '../../../../shared/types'
import {
  chatContentText,
  chatReferences,
  hasUserText,
  selectionLabel
} from '../../../../shared/chatContent'
import {
  DocumentSelectionContext,
  type SelectionLocation
} from '../workbench/composer/DocumentSelectionContext'
import ComposerInputEditor from '../workbench/composer/ComposerInputEditor'
import {
  captureSelection,
  locateSelection,
  rangeForLocation,
  readPreviewText
} from './docxSelectionText'
import {
  positionSelectionFloating,
  positionSelectionMarker,
  previewViewport,
  SELECTION_MARKER_SIZE,
  visiblePreviewObstacles,
  type SelectionFloatingPosition,
  type SelectionMarkerPosition
} from './docxSelectionLayout'

type Popup = {
  node: DocumentSelectionNode
  location: SelectionLocation
  mode: 'action' | 'editor'
}
type Marker = SelectionMarkerPosition & {
  node: DocumentSelectionNode
  location: SelectionLocation
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
  const [popup, setPopup] = useState<Popup | null>(null)
  const [floating, setFloating] = useState<SelectionFloatingPosition | null>(null)
  const [markers, setMarkers] = useState<Marker[]>([])
  const [notice, setNotice] = useState('')
  const popupRef = useRef<HTMLDivElement>(null)
  const latestRef = useRef(state)
  const popupId = popup?.node.id
  const popupMode = popup?.mode
  const popupLocation = popup?.location
  useEffect(() => {
    latestRef.current = state
  }, [state])
  const open = (
    node: DocumentSelectionNode,
    location: SelectionLocation,
    mode: Popup['mode']
  ): void => {
    setNotice('')
    setFloating(null)
    setPopup({ node, location, mode })
    window.getSelection()?.removeAllRanges()
  }

  useEffect(() => {
    if (!container || !state?.enabled || !revision) return
    const capture = (): void => {
      if (latestRef.current?.locked) return
      const selection = window.getSelection()
      if (!selection?.rangeCount || selection.isCollapsed) return
      const range = selection.getRangeAt(0)
      if (!container.contains(range.commonAncestorContainer)) return
      const preview = readPreviewText(container)
      const location = captureSelection(container, preview, range)
      if (!location) {
        setNotice('请选择正文中的连续文本；表格仅支持单个单元格。')
        return
      }
      const nodes = latestRef.current?.selections.filter((node) => node.filePath === filePath) || []
      for (const node of nodes) {
        const existing = locateSelection(preview, node, latestRef.current?.locations.get(node.id))
        if (!existing) continue
        if (existing.start === location.start && existing.end === location.end) {
          open(node, existing, 'action')
          return
        }
        if (existing.start < location.end && location.start < existing.end) {
          setNotice('该选区与已有编号重叠，请调整选取范围。')
          return
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
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.shiftKey || event.key === 'Shift') capture()
    }
    container.addEventListener('pointerup', capture)
    container.addEventListener('keyup', onKeyUp)
    return () => {
      container.removeEventListener('pointerup', capture)
      container.removeEventListener('keyup', onKeyUp)
    }
  }, [container, filePath, revision, state?.enabled])

  useLayoutEffect(() => {
    if (!container || !revision || !state?.enabled) return
    const key = 'docx-' + crypto.randomUUID()
    const activeKey = key + '-active'
    const style = document.createElement('style')
    style.textContent =
      '::highlight(' +
      key +
      ') { background-color: #E9DDFB; }' +
      '::highlight(' +
      activeKey +
      ') { background-color: #DBC5F6; }'
    document.head.appendChild(style)
    let frame = 0
    const update = (): void => {
      const preview = readPreviewText(container)
      const origin = container.parentElement!.getBoundingClientRect()
      const viewport = previewViewport(container)
      const next: Marker[] = []
      const ranges: Range[] = []
      const nodes = state.selections.filter((node) => node.filePath === filePath)
      const obstacles = nodes.length ? visiblePreviewObstacles(preview, container) : []
      for (const node of nodes) {
        const location = locateSelection(preview, node, state.locations.get(node.id))
        const range = location && rangeForLocation(preview, location)
        if (!range || !location) continue
        ranges.push(range)
        const position = positionSelectionMarker(range, viewport, obstacles, node.number)
        if (!position) continue
        obstacles.push({
          left: position.left,
          top: position.top,
          right: position.left + position.width,
          bottom: position.top + SELECTION_MARKER_SIZE
        })
        next.push({
          node,
          location,
          ...position,
          left: position.left - origin.left,
          top: position.top - origin.top
        })
      }
      CSS.highlights.set(key, new Highlight(...ranges))
      setMarkers(next)

      const activeRange =
        popupLocation?.previewText === preview.text
          ? rangeForLocation(preview, popupLocation)
          : null
      const activeHighlight = new Highlight(...(activeRange ? [activeRange] : []))
      activeHighlight.priority = 1
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
      style.remove()
    }
  }, [
    container,
    revision,
    filePath,
    state?.enabled,
    state?.selections,
    state?.locations,
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
      setNotice('原文已变化或位置不唯一，无法定位该选区。')
      return
    }
    range.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'instant' })
    const selected = window.getSelection()
    selected?.removeAllRanges()
    selected?.addRange(range)
  }, [container, revision, filePath, state?.navigation, state?.locations])

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
    setNotice('')
  }, [filePath, revision, state?.enabled])

  if (!state?.enabled) return null
  const save = (): void => {
    if (!popup || state.locked || !hasUserText(popup.node.children)) return
    state.save(popup.node, popup.location)
    setPopup(null)
    window.getSelection()?.removeAllRanges()
  }
  return (
    <>
      {markers.map((marker) => (
        <button
          key={marker.node.id}
          type="button"
          data-testid="docx-selection-marker"
          aria-label={'编辑 ' + selectionLabel(marker.node)}
          title={selectionLabel(marker.node) + '\n' + marker.node.selectedText}
          disabled={state.locked}
          className="absolute z-10 flex cursor-pointer items-center justify-center rounded-[4px] bg-[#E3D4F3] text-[9px] font-semibold leading-none text-[#79569F] outline-none hover:bg-[#D8C2EF] focus-visible:ring-2 focus-visible:ring-[#0B6BCB] disabled:cursor-not-allowed"
          style={{
            left: marker.left,
            top: marker.top,
            width: marker.width,
            height: SELECTION_MARKER_SIZE
          }}
          onClick={() => {
            const current = state.selections.find((node) => node.id === marker.node.id)
            if (current) open(current, marker.location, 'editor')
          }}
        >
          {marker.node.number}
        </button>
      ))}
      {notice && (
        <button
          type="button"
          className="absolute bottom-3 left-3 right-3 z-20 rounded-md bg-white px-3 py-2 text-sm text-[#787774] shadow"
          onClick={() => setNotice('')}
        >
          {notice}
        </button>
      )}
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
                data-testid="docx-selection-ai-edit"
                disabled={state.locked}
                className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-[#37352F] outline-none hover:bg-[#F4F4F2] focus-visible:ring-2 focus-visible:ring-[#0B6BCB] disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => setPopup((previous) => previous && { ...previous, mode: 'editor' })}
              >
                <HiOutlineSparkles className="h-4 w-4 text-[#80649F]" aria-hidden="true" />
                AI 编辑
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
                  placeholder="描述编辑内容"
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
