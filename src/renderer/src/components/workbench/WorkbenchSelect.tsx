import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import { HiCheck, HiChevronDown, HiChevronRight, HiMagnifyingGlass } from 'react-icons/hi2'
import type { WorkbenchSelectOption } from './types'
import { resolveFloatingPlacement, type FloatingPlacementAlign } from './floatingPlacement'

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
  rail?: boolean
  inlineChevron?: boolean
  hideChevron?: boolean
  hideTriggerIcon?: boolean
  disabled?: boolean
  noDrag?: boolean
  minMenuWidth?: number
  maxMenuWidth?: number
  menuAlign?: FloatingPlacementAlign
  menuPreferredHeight?: number
  menuMaxHeight?: number
  showDescriptions?: boolean
  emptyAction?: {
    label: string
    icon?: React.ReactNode
    onClick: () => void
  }
  'data-testid'?: string
}

type MenuPosition = {
  top?: number
  bottom?: number
  left: number
  width: number
  maxHeight: number
  placement: 'top' | 'bottom'
}

type SubmenuState = {
  parentValue: string
  options: WorkbenchSelectOption[]
  top: number
  left: number
  width: number
}

const joinClassNames = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(' ')

const DEFAULT_MENU_POSITION: MenuPosition = {
  left: 0,
  width: 240,
  maxHeight: 320,
  placement: 'bottom'
}
const SEARCH_MENU_HEADER_HEIGHT = 48
const MENU_VERTICAL_PADDING = 12
const MENU_OPTION_HEIGHT = 36
const MENU_OPTION_WITH_DESCRIPTION_HEIGHT = 60
const SUBMENU_WIDTH = 220
const SUBMENU_GAP = 6

const estimateMenuHeight = (input: {
  optionCount: number
  searchable: boolean
  maxHeight: number
  showDescriptions: boolean
}): number => {
  const listItemCount = Math.max(1, input.optionCount)
  const optionHeight = input.showDescriptions ? MENU_OPTION_WITH_DESCRIPTION_HEIGHT : MENU_OPTION_HEIGHT
  const estimatedListHeight = MENU_VERTICAL_PADDING + listItemCount * optionHeight
  const estimatedHeight = estimatedListHeight + (input.searchable ? SEARCH_MENU_HEADER_HEIGHT : 0)
  return Math.min(input.maxHeight, estimatedHeight)
}

const findSelectedOption = (
  options: WorkbenchSelectOption[],
  value: string | null
): WorkbenchSelectOption | null => {
  for (const option of options) {
    if (option.value === value) return option
    const child = option.children ? findSelectedOption(option.children, value) : null
    if (child) return child
  }
  return null
}

const hasSelectedChild = (option: WorkbenchSelectOption, value: string | null): boolean =>
  Boolean(option.children?.some((child) => child.value === value || hasSelectedChild(child, value)))

const getFirstEnabledChild = (option: WorkbenchSelectOption): WorkbenchSelectOption | null =>
  option.children?.find((child) => !child.disabled) || null

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
  rail = false,
  inlineChevron = false,
  hideChevron = false,
  hideTriggerIcon = false,
  disabled = false,
  noDrag = false,
  minMenuWidth,
  maxMenuWidth,
  menuAlign = 'start',
  menuPreferredHeight,
  menuMaxHeight,
  showDescriptions = false,
  emptyAction,
  'data-testid': dataTestId
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const submenuRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [menuPosition, setMenuPosition] = useState<MenuPosition>(DEFAULT_MENU_POSITION)
  const [submenu, setSubmenu] = useState<SubmenuState | null>(null)
  const listboxId = useId()

  const selectedOption = useMemo(
    () => findSelectedOption(options, value),
    [options, value]
  )

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return options
    return options.filter((option) => {
      const childFields =
        option.children?.flatMap((child) => [
          child.label,
          child.description || '',
          child.triggerLabel || '',
          ...(child.keywords || [])
        ]) || []
      const fields = [
        option.label,
        option.triggerLabel || '',
        option.description || '',
        ...(option.keywords || []),
        ...childFields
      ]
      return fields.some((field) => field.toLowerCase().includes(normalizedQuery))
    })
  }, [options, query])

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const minimumWidth = minMenuWidth || (compact ? 200 : 240)
    const preferredWidth = Math.max(rect.width, minimumWidth)
    const constrainedWidth = maxMenuWidth ? Math.min(preferredWidth, maxMenuWidth) : preferredWidth
    const maxHeight = menuMaxHeight ?? (searchable ? 420 : 320)
    const preferredHeight =
      menuPreferredHeight ??
      estimateMenuHeight({
        optionCount: filteredOptions.length,
        searchable,
        maxHeight,
        showDescriptions
      })
    const placement = resolveFloatingPlacement({
      triggerRect: rect,
      viewportWidth,
      viewportHeight,
      preferredWidth: constrainedWidth,
      preferredHeight,
      maxHeight,
      minWidth: minimumWidth,
      maxWidth: maxMenuWidth,
      align: menuAlign
    })
    setMenuPosition({
      ...placement,
      maxHeight: Math.max(
        120,
        searchable ? placement.maxHeight - SEARCH_MENU_HEADER_HEIGHT : placement.maxHeight
      )
    })
  }, [
    compact,
    maxMenuWidth,
    menuAlign,
    menuMaxHeight,
    menuPreferredHeight,
    minMenuWidth,
    filteredOptions.length,
    searchable,
    showDescriptions
  ])

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
      if (submenuRef.current?.contains(target)) return
      setOpen(false)
    }

    const handleResize = (): void => {
      updateMenuPosition()
      setSubmenu(null)
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setSubmenu(null)
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
      setSubmenu(null)
      return
    }
    if (!searchable) return
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })
  }, [open, searchable])

  const openSubmenu = useCallback((option: WorkbenchSelectOption, trigger: HTMLElement): void => {
    if (!option.children || option.children.length === 0) {
      setSubmenu(null)
      return
    }
    const rect = trigger.getBoundingClientRect()
    const estimatedHeight = MENU_VERTICAL_PADDING + option.children.length * MENU_OPTION_HEIGHT
    const top = Math.max(8, Math.min(rect.top, window.innerHeight - estimatedHeight - 8))
    const rightLeft = rect.right + SUBMENU_GAP
    const left =
      rightLeft + SUBMENU_WIDTH <= window.innerWidth - 8
        ? rightLeft
        : Math.max(8, rect.left - SUBMENU_WIDTH - SUBMENU_GAP)
    setSubmenu({
      parentValue: option.value,
      options: option.children,
      top,
      left,
      width: SUBMENU_WIDTH
    })
  }, [])

  const handleOptionSelect = useCallback(
    (option: WorkbenchSelectOption): void => {
      if (option.disabled) return
      const child = option.children ? getFirstEnabledChild(option) : null
      onChange(child?.value || option.value)
      setSubmenu(null)
      setOpen(false)
    },
    [onChange]
  )

  const triggerLabel = selectedOption?.triggerLabel || selectedOption?.label || placeholder
  const triggerIconNode = selectedOption?.triggerIcon || selectedOption?.icon || triggerIcon
  const triggerSuffixNode = selectedOption?.triggerSuffix || null

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
        title={triggerLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        className={joinClassNames(
          'workbench-select-trigger',
          compact ? 'workbench-select-trigger-compact' : '',
          rail ? 'workbench-select-trigger-rail' : '',
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
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {!hideTriggerIcon && triggerIconNode ? (
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              {triggerIconNode}
            </span>
          ) : null}
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate">{triggerLabel}</span>
            {triggerSuffixNode ? (
              <span className="flex shrink-0 items-center">{triggerSuffixNode}</span>
            ) : null}
          </span>
          {inlineChevron && !hideChevron ? (
            <HiChevronDown
              className={joinClassNames(
                'h-3.5 w-3.5 shrink-0 transition-transform duration-150',
                open ? 'rotate-180' : ''
              )}
            />
          ) : null}
        </span>
        {!inlineChevron && !hideChevron ? (
          <HiChevronDown
            className={joinClassNames(
              'h-3.5 w-3.5 shrink-0 transition-transform duration-150',
              open ? 'rotate-180' : ''
            )}
          />
        ) : null}
      </button>

      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={listboxId}
              role="listbox"
              className={joinClassNames('workbench-select-menu', menuClassName)}
              data-workbench-select-root="true"
              style={{
                position: 'fixed',
                top: menuPosition.top,
                bottom: menuPosition.bottom,
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

              <div className="overflow-y-auto py-1.5" style={{ maxHeight: menuPosition.maxHeight }}>
                {filteredOptions.length > 0 ? (
                  filteredOptions.map((option) => {
                    const selected = option.value === value
                    const childSelected = hasSelectedChild(option, value)
                    const hasChildren = Boolean(option.children?.length)
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="option"
                        aria-selected={selected || childSelected}
                        disabled={option.disabled}
                        className={joinClassNames(
                          'workbench-select-option',
                          showDescriptions && option.description
                            ? 'workbench-select-option-with-description'
                            : '',
                          selected || childSelected ? 'workbench-select-option-selected' : '',
                          (selected || childSelected) && selectedWithoutBackground
                            ? 'workbench-select-option-selected-plain'
                            : '',
                          option.disabled ? 'workbench-select-option-disabled' : ''
                        )}
                        onMouseEnter={(event) => {
                          openSubmenu(option, event.currentTarget)
                        }}
                        onClick={() => handleOptionSelect(option)}
                      >
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          {option.icon ? (
                            <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[#787774]">
                              {option.icon}
                            </span>
                          ) : null}
                          <span className="min-w-0 flex-1">
                            <span
                              className={joinClassNames(
                                'block truncate text-[13px] font-medium text-[#37352F]',
                                option.labelClassName
                              )}
                            >
                              {option.label}
                            </span>
                            {showDescriptions && option.description ? (
                              <span
                                className={joinClassNames(
                                  'mt-0.5 block truncate text-[12px] leading-4 text-[#91918E]',
                                  option.descriptionClassName
                                )}
                              >
                                {option.description}
                              </span>
                            ) : null}
                          </span>
                          {!hasChildren && option.trailing ? (
                            <span className="ml-0.5 flex shrink-0 items-center text-[#787774]">
                              {option.trailing}
                            </span>
                          ) : null}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5 text-[#787774]">
                          {hasChildren ? (
                            <HiChevronRight className="h-3.5 w-3.5 text-[#9B9A97]" />
                          ) : selected ? (
                            <HiCheck className="h-3.5 w-3.5 text-[#37352F]" />
                          ) : null}
                        </span>
                      </button>
                    )
                  })
                ) : emptyAction && options.length === 0 && query.trim().length === 0 ? (
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="workbench-select-option"
                    onClick={() => {
                      setOpen(false)
                      emptyAction.onClick()
                    }}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {emptyAction.icon ? (
                        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[#787774]">
                          {emptyAction.icon}
                        </span>
                      ) : null}
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#37352F]">
                        {emptyAction.label}
                      </span>
                    </span>
                  </button>
                ) : (
                  <div className="px-4 py-6 text-center text-[12px] text-[#91918E]">暂无结果</div>
                )}
              </div>
            </div>,
            document.body
          )
        : null}
      {open && submenu
        ? createPortal(
            <div
              ref={submenuRef}
              role="listbox"
              className={joinClassNames('workbench-select-menu', menuClassName)}
              data-workbench-select-root="true"
              data-workbench-select-submenu-parent={submenu.parentValue}
              style={{
                position: 'fixed',
                top: submenu.top,
                left: submenu.left,
                width: submenu.width,
                zIndex: 1001
              }}
            >
              <div className="py-1.5">
                {submenu.options.map((option) => {
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
                      onClick={() => handleOptionSelect(option)}
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        {option.icon ? (
                          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[#787774]">
                            {option.icon}
                          </span>
                        ) : null}
                        <span className="min-w-0 truncate text-[13px] font-medium text-[#37352F]">
                          {option.label}
                        </span>
                        {option.trailing ? (
                          <span className="ml-0.5 flex shrink-0 items-center text-[#787774]">
                            {option.trailing}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5 text-[#787774]">
                        {selected ? (
                          <HiCheck className="h-3.5 w-3.5 text-[#37352F]" />
                        ) : null}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  )
}

export default WorkbenchSelect
