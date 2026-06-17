import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { HiCheck, HiChevronDown, HiFolder } from 'react-icons/hi2'
import type { WorkspaceQuickSelectPopupPosition, WorkspaceQuickSelectProps } from './types'

const DEFAULT_POPUP_POSITION: WorkspaceQuickSelectPopupPosition = {
  top: 0,
  left: 0,
  maxWidth: 360
}

const joinClassNames = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(' ')

const WorkspaceQuickSelect: React.FC<WorkspaceQuickSelectProps> = ({
  workspaces,
  selectedWorkspaceId,
  onWorkspaceChange,
  placeholder = '选择工作空间',
  className,
  noDrag = false,
  'data-testid': dataTestId
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [popupPosition, setPopupPosition] =
    useState<WorkspaceQuickSelectPopupPosition>(DEFAULT_POPUP_POSITION)

  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === selectedWorkspaceId) || null

  const updatePopupPosition = (): void => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const left = rect.right + 8
    const availableRight = viewportWidth - left - 12
    const fallbackLeft = Math.max(12, rect.left)
    const fallbackWidth = viewportWidth - fallbackLeft - 12

    if (availableRight >= 220) {
      setPopupPosition({
        top: rect.top,
        left,
        maxWidth: Math.min(availableRight, 560)
      })
      return
    }

    setPopupPosition({
      top: rect.bottom + 8,
      left: fallbackLeft,
      maxWidth: Math.min(fallbackWidth, 560)
    })
  }

  useLayoutEffect(() => {
    if (!open) return
    updatePopupPosition()
  }, [open])

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target)) return
      if (popupRef.current?.contains(target)) return
      setOpen(false)
    }

    const handleLayoutChange = (): void => {
      updatePopupPosition()
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('resize', handleLayoutChange)
    window.addEventListener('scroll', handleLayoutChange, true)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('resize', handleLayoutChange)
      window.removeEventListener('scroll', handleLayoutChange, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const triggerLabel = selectedWorkspace?.name || placeholder

  return (
    <div
      ref={rootRef}
      className={joinClassNames('relative min-w-0', className)}
      data-workbench-select-root="true"
    >
      <button
        ref={triggerRef}
        type="button"
        className={joinClassNames(
          'workspace-quick-select-trigger',
          open ? 'workspace-quick-select-trigger-open' : '',
          noDrag ? 'workbench-no-drag' : ''
        )}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={dataTestId}
      >
        <HiFolder className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{triggerLabel}</span>
        <HiChevronDown
          className={joinClassNames(
            'h-3.5 w-3.5 shrink-0 transition-transform duration-150',
            open ? 'rotate-180' : ''
          )}
        />
      </button>

      {open
        ? createPortal(
            <div
              ref={popupRef}
              className="workspace-quick-select-popup"
              style={{
                position: 'fixed',
                top: popupPosition.top,
                left: popupPosition.left,
                maxWidth: popupPosition.maxWidth,
                zIndex: 1000
              }}
              role="listbox"
            >
              {workspaces.length > 0 ? (
                workspaces.map((workspace) => {
                  const selected = workspace.id === selectedWorkspaceId
                  return (
                    <button
                      key={workspace.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={joinClassNames(
                        'workspace-quick-select-option',
                        selected ? 'workspace-quick-select-option-selected' : ''
                      )}
                      onClick={() => {
                        onWorkspaceChange(workspace.id)
                        setOpen(false)
                      }}
                    >
                      <span className="truncate">{workspace.name}</span>
                      {selected ? <HiCheck className="h-3.5 w-3.5 shrink-0" /> : null}
                    </button>
                  )
                })
              ) : (
                <div className="workspace-quick-select-empty">暂无工作空间</div>
              )}
            </div>,
            document.body
          )
        : null}
    </div>
  )
}

export default WorkspaceQuickSelect
