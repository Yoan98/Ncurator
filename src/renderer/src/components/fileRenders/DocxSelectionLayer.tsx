import { useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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

type Popup = { node: DocumentSelectionNode; location: SelectionLocation; left: number; top: number }
type Marker = {
  node: DocumentSelectionNode
  location: SelectionLocation
  left: number
  top: number
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
  const [markers, setMarkers] = useState<Marker[]>([])
  const [notice, setNotice] = useState('')
  const popupRef = useRef<HTMLDivElement>(null)
  const latestRef = useRef(state)
  useEffect(() => {
    latestRef.current = state
  }, [state])
  const open = (node: DocumentSelectionNode, location: SelectionLocation, rect: DOMRect): void => {
    setNotice('')
    setPopup({
      node,
      location,
      left: Math.max(12, Math.min(rect.left, window.innerWidth - 372)),
      top: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 310))
    })
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
          open(node, existing, range.getBoundingClientRect())
          return
        }
        if (existing.start < location.end && location.start < existing.end) {
          setNotice('该选区与已有编号重叠，请调整选取范围。')
          return
        }
      }
      const selectedText = preview.text.slice(location.start, location.end)
      open(
        {
          kind: 'document_selection',
          id: crypto.randomUUID(),
          number: 0,
          filePath,
          selectedText,
          contextBefore: Array.from(preview.text.slice(0, location.start)).slice(-150).join(''),
          contextAfter: Array.from(preview.text.slice(location.end)).slice(0, 150).join(''),
          children: []
        },
        location,
        range.getBoundingClientRect()
      )
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.shiftKey) capture()
    }
    container.addEventListener('pointerup', capture)
    container.addEventListener('keyup', onKeyUp)
    return () => {
      container.removeEventListener('pointerup', capture)
      container.removeEventListener('keyup', onKeyUp)
    }
  }, [container, filePath, revision, state?.enabled])

  useEffect(() => {
    if (!container || !revision) return
    const key = `docx-${crypto.randomUUID()}`
    const style = document.createElement('style')
    style.textContent = `::highlight(${key}) { background-color: #dce9ff; }`
    document.head.appendChild(style)
    let frame = 0
    const update = (): void => {
      const preview = readPreviewText(container)
      const origin = container.parentElement!.getBoundingClientRect()
      const bounds = container.getBoundingClientRect()
      const next: Marker[] = []
      const ranges: Range[] = []
      for (const node of state?.selections || []) {
        if (node.filePath !== filePath) continue
        const location = locateSelection(preview, node, state?.locations.get(node.id))
        const range = location && rangeForLocation(preview, location)
        if (!range || !location) continue
        ranges.push(range)
        const rect = range.getClientRects()[0]
        if (rect && rect.bottom >= bounds.top && rect.top <= bounds.bottom) {
          next.push({
            node,
            location,
            left: Math.min(bounds.right - origin.left - 32, rect.right - origin.left + 4),
            top: rect.top - origin.top
          })
        }
      }
      CSS.highlights.set(key, new Highlight(...ranges))
      setMarkers(next)
    }
    const schedule = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    update()
    container.addEventListener('scroll', schedule)
    const observer = new ResizeObserver(schedule)
    observer.observe(container)
    return () => {
      cancelAnimationFrame(frame)
      container.removeEventListener('scroll', schedule)
      observer.disconnect()
      CSS.highlights.delete(key)
      style.remove()
    }
  }, [container, revision, filePath, state?.selections, state?.locations])

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

  const popupId = popup?.node.id
  useEffect(() => {
    if (!popupId) return
    const outside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !popupRef.current?.contains(event.target)) setPopup(null)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPopup(null)
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    popupRef.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus()
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [popupId])

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
          title={selectionLabel(marker.node)}
          disabled={state.locked}
          className="absolute z-10 flex h-6 min-w-6 items-center justify-center rounded-full border border-[#B8D1FA] bg-[#E8F0FE] px-1 text-xs text-[#2457A7] shadow-sm"
          style={{ left: marker.left, top: marker.top }}
          onClick={() => {
            const current = state.selections.find((node) => node.id === marker.node.id)
            if (current && container) {
              const range = rangeForLocation(readPreviewText(container), marker.location)
              if (range) open(current, marker.location, range.getBoundingClientRect())
            }
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
            className="fixed z-[1100] w-[360px] rounded-lg border border-[#E5E4E0] bg-white p-3 shadow-lg"
            style={{ left: popup.left, top: popup.top }}
          >
            <div className="mb-2 text-xs text-[#787774]">
              {popup.node.number ? selectionLabel(popup.node) : '引用文档选区'}
            </div>
            <div className="mb-3 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-[#F4F4F2] p-2 text-xs text-[#787774]">
              {popup.node.selectedText}
            </div>
            <ComposerInputEditor
              value={{
                contentNodes: popup.node.children,
                input: chatContentText(popup.node.children),
                selectedReferences: chatReferences(popup.node.children)
              }}
              placeholder="输入你的想法，编辑或提问都可以"
              dataTestId="docx-selection-thought"
              disabled={state.locked}
              onSubmit={save}
              editorClassName="max-h-32 overflow-auto"
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
            <div className="mt-3 flex justify-between text-xs">
              {popup.node.number ? (
                <button
                  type="button"
                  disabled={state.locked}
                  className="text-[#B3261E]"
                  onClick={() => {
                    state.remove(popup.node.id)
                    setPopup(null)
                  }}
                >
                  删除引用
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                data-testid="docx-selection-save"
                disabled={state.locked || !hasUserText(popup.node.children)}
                className="rounded bg-[#37352F] px-3 py-1.5 text-white disabled:opacity-40"
                onClick={save}
              >
                保存
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
