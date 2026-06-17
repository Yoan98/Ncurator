import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { HiCheck, HiChevronDown, HiMagnifyingGlass } from 'react-icons/hi2'
import type { WorkbenchSelectOption } from './types'

type WorkbenchSelectProps = {
  value: string | null
  options: WorkbenchSelectOption[]
  onChange: (value: string) => void
  placeholder: string
  triggerIcon?: React.ReactNode
  searchPlaceholder?: string
  searchable?: boolean
  className?: string
  menuClassName?: string
  triggerClassName?: string
  compact?: boolean
  selectedWithoutBackground?: boolean
  disabled?: boolean
  noDrag?: boolean
  'data-testid'?: string
}

type MenuPosition = {
  top: number
  left: number
  width: number
}

const joinClassNames = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(' ')

const DEFAULT_MENU_POSITION: MenuPosition = {
  top: 0,
  left: 0,
  width: 240
}

const WorkbenchSelect: React.FC<WorkbenchSelectProps> = ({
  value,
  options,
  onChange,
  placeholder,
  triggerIcon,
  searchPlaceholder = '搜索',
  searchable = false,
  className,
  menuClassName,
  triggerClassName,
  compact = false,
  selectedWithoutBackground = false,
  disabled = false,
  noDrag = false,
  'data-testid': dataTestId
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [menuPosition, setMenuPosition] = useState<MenuPosition>(DEFAULT_MENU_POSITION)
  const listboxId = useId()

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) || null,
    [options, value]
  )

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return options
    return options.filter((option) => {
      const fields = [option.label, option.description || '', ...(option.keywords || [])]
      return fields.some((field) => field.toLowerCase().includes(normalizedQuery))
    })
  }, [options, query])

  const updateMenuPosition = useMemo(
    () => () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const preferredWidth = Math.max(rect.width, compact ? 200 : 240)
      const maxWidth = Math.min(preferredWidth, viewportWidth - 24)
      const left = Math.min(rect.left, viewportWidth - maxWidth - 12)
      setMenuPosition({
        top: rect.bottom + 8,
        left: Math.max(12, left),
        width: maxWidth
      })
    },
    [compact]
  )

  useLayoutEffect(() => {
    if (!open) return
    updateMenuPosition()
  }, [open, updateMenuPosition])

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }

    const handleResize = (): void => {
      updateMenuPosition()
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('resize', handleResize)
    window.addEventListener('scroll', handleResize, true)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('scroll', handleResize, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, updateMenuPosition])

  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }
    if (!searchable) return
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })
  }, [open, searchable])

  const triggerLabel = selectedOption?.label || placeholder
  const triggerIconNode = selectedOption?.icon || triggerIcon

  return (
    <div
      ref={rootRef}
      className={joinClassNames('relative min-w-0', className)}
      data-workbench-select-root="true"
      data-testid={dataTestId}
    >
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        className={joinClassNames(
          'workbench-select-trigger',
          compact ? 'workbench-select-trigger-compact' : '',
          open ? 'workbench-select-trigger-open' : '',
          disabled ? 'workbench-select-trigger-disabled' : '',
          noDrag ? 'workbench-no-drag' : '',
          triggerClassName
        )}
        onClick={() => {
          if (disabled) return
          setOpen((current) => !current)
        }}
      >
        <span className="flex min-w-0 items-center gap-2">
          {triggerIconNode ? (
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              {triggerIconNode}
            </span>
          ) : null}
          <span className="truncate">{triggerLabel}</span>
        </span>
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
              ref={menuRef}
              id={listboxId}
              role="listbox"
              className={joinClassNames('workbench-select-menu', menuClassName)}
              style={{
                position: 'fixed',
                top: menuPosition.top,
                left: menuPosition.left,
                width: menuPosition.width,
                zIndex: 1000
              }}
            >
              {searchable ? (
                <div className="workbench-select-search">
                  <HiMagnifyingGlass className="h-3.5 w-3.5 shrink-0 text-[#91918E]" />
                  <input
                    ref={searchInputRef}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={searchPlaceholder}
                    className="workbench-select-search-input"
                  />
                </div>
              ) : null}

              <div className="max-h-[320px] overflow-y-auto py-1.5">
                {filteredOptions.length > 0 ? (
                  filteredOptions.map((option) => {
                    const selected = option.value === value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        disabled={option.disabled}
                        className={joinClassNames(
                          'workbench-select-option',
                          selected ? 'workbench-select-option-selected' : '',
                          selected && selectedWithoutBackground
                            ? 'workbench-select-option-selected-plain'
                            : '',
                          option.disabled ? 'workbench-select-option-disabled' : ''
                        )}
                        onClick={() => {
                          if (option.disabled) return
                          onChange(option.value)
                          setOpen(false)
                        }}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          {option.icon ? (
                            <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[#787774]">
                              {option.icon}
                            </span>
                          ) : null}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-[#37352F]">
                              {option.label}
                            </span>
                            {option.description ? (
                              <span className="mt-0.5 block truncate text-[12px] text-[#91918E]">
                                {option.description}
                              </span>
                            ) : null}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2 text-[#787774]">
                          {option.trailing}
                          {selected ? <HiCheck className="h-4 w-4 text-[#37352F]" /> : null}
                        </span>
                      </button>
                    )
                  })
                ) : (
                  <div className="px-4 py-6 text-center text-[12px] text-[#91918E]">暂无结果</div>
                )}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  )
}

export default WorkbenchSelect
