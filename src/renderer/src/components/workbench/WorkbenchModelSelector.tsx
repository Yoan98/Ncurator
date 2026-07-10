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
import { Tooltip } from 'antd'
import {
  HiCheck,
  HiChevronLeft,
  HiChevronRight,
  HiCpuChip,
  HiMagnifyingGlass,
  HiPhoto,
  HiQuestionMarkCircle
} from 'react-icons/hi2'
import type {
  LLMConfig,
  LlmRemoteModel,
  WorkbenchModelSelection,
  WorkbenchSelectedModel
} from '../../../../shared/types'
import { resolveFloatingPlacement } from './floatingPlacement'

type WorkbenchModelSelectorProps = {
  configs: LLMConfig[]
  modelListsByConfigId: Record<string, LlmRemoteModel[]>
  value: WorkbenchModelSelection
  onChange: (value: WorkbenchModelSelection) => void
  onAfterChange?: () => void
  disabled?: boolean
  noDrag?: boolean
  className?: string
  'data-testid'?: string
}

type PanelView = 'root' | 'main' | 'vision'

type MenuPosition = {
  top?: number
  bottom?: number
  left: number
  width: number
  maxHeight: number
}

const DEFAULT_POSITION: MenuPosition = {
  left: 0,
  width: 360,
  maxHeight: 360
}

const joinClassNames = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(' ')

const getConfigLabel = (config: LLMConfig | null | undefined): string =>
  config?.name?.trim() || config?.base_url?.trim() || '模型配置'

const getSelectedLabel = (
  selection: WorkbenchSelectedModel | null,
  configs: LLMConfig[]
): string => {
  if (!selection) return '未选择'
  const config = configs.find((item) => item.id === selection.configId)
  return `${getConfigLabel(config)} / ${selection.modelName}`
}

const getVisionInitial = (modelName: string): string => {
  const match = modelName.match(/[A-Za-z0-9]/u)
  return match ? match[0].toUpperCase() : ''
}

const modelMatchesQuery = (input: {
  query: string
  config: LLMConfig
  model: LlmRemoteModel
}): boolean => {
  const query = input.query.trim().toLowerCase()
  if (!query) return true
  const fields = [
    input.model.id,
    input.model.label || '',
    input.config.name || '',
    input.config.base_url || ''
  ]
  return fields.some((field) => field.toLowerCase().includes(query))
}

const isSameSelection = (
  left: WorkbenchSelectedModel | null,
  right: WorkbenchSelectedModel | null
): boolean => left?.configId === right?.configId && left?.modelName === right?.modelName

const WorkbenchModelSelector: React.FC<WorkbenchModelSelectorProps> = ({
  configs,
  modelListsByConfigId,
  value,
  onChange,
  onAfterChange,
  disabled = false,
  noDrag = false,
  className,
  'data-testid': dataTestId
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const listboxId = useId()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<PanelView>('root')
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState<MenuPosition>(DEFAULT_POSITION)

  const mainLabel = value.mainModel?.modelName || '选择模型'
  const visionInitial = value.visionModel ? getVisionInitial(value.visionModel.modelName) : ''
  const tooltip = value.mainModel ? (
    <div className="space-y-1 text-xs leading-5">
      <div>主模型：{getSelectedLabel(value.mainModel, configs)}</div>
      {value.visionModel ? (
        <div>视觉模型：{getSelectedLabel(value.visionModel, configs)}</div>
      ) : null}
    </div>
  ) : (
    '请选择主模型'
  )

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const placement = resolveFloatingPlacement({
      triggerRect: rect,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      preferredWidth: 380,
      preferredHeight: 360,
      minWidth: 340,
      maxWidth: 460,
      maxHeight: 420,
      align: 'end'
    })
    setPosition({
      left: placement.left,
      top: placement.top,
      bottom: placement.bottom,
      width: placement.width,
      maxHeight: Math.max(160, placement.maxHeight)
    })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const handleResize = (): void => updatePosition()
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
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) {
      setView('root')
      setQuery('')
      return
    }
    if (view === 'root') return
    window.requestAnimationFrame(() => searchInputRef.current?.focus())
  }, [open, view])

  const selectModel = (model: WorkbenchSelectedModel): void => {
    const nextValue: WorkbenchModelSelection =
      view === 'main'
        ? {
            mainModel: model,
            visionModel: isSameSelection(value.visionModel, model) ? null : value.visionModel
          }
        : { ...value, visionModel: model }
    onChange(nextValue)
    setOpen(false)
    onAfterChange?.()
  }

  const selectFollowMain = (): void => {
    onChange({ ...value, visionModel: null })
    setOpen(false)
    onAfterChange?.()
  }

  const groupedModels = useMemo(
    () => {
      const customModelName = query.trim()
      return configs
        .map((config) => {
          const models = (modelListsByConfigId[config.id] || []).filter((model) =>
            modelMatchesQuery({ query, config, model })
          )
          const hasCustomModel =
            customModelName && !models.some((model) => model.id === customModelName)
          return {
            config,
            models: hasCustomModel
              ? [...models, { id: customModelName, label: customModelName }]
              : models
          }
        })
        .filter((group) => group.models.length > 0)
    },
    [configs, modelListsByConfigId, query]
  )

  const renderModelList = (): React.ReactNode => {
    const currentSelection = view === 'main' ? value.mainModel : value.visionModel
    return (
      <>
        <div className="flex items-center gap-2 border-b border-[#EEEEEC] px-2.5 py-2">
          <button
            type="button"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[#787774] hover:bg-[#F4F4F2] hover:text-[#37352F]"
            onClick={() => {
              setView('root')
              setQuery('')
            }}
          >
            <HiChevronLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1 text-[13px] font-semibold text-[#37352F]">
            {view === 'main' ? '选择主模型' : '选择视觉模型'}
          </div>
        </div>
        <div className="workbench-select-search">
          <HiMagnifyingGlass className="h-3.5 w-3.5 shrink-0 text-[#91918E]" />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索模型"
            className="workbench-select-search-input"
          />
        </div>
        <div className="overflow-y-auto py-1.5" style={{ maxHeight: position.maxHeight - 88 }}>
          {view === 'vision' && !query.trim() ? (
            <button
              type="button"
              role="option"
              aria-selected={!value.visionModel}
              className={joinClassNames(
                'workbench-select-option',
                !value.visionModel ? 'workbench-select-option-selected' : ''
              )}
              onClick={selectFollowMain}
            >
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#37352F]">
                跟随主模型
              </span>
              {!value.visionModel ? <HiCheck className="h-3.5 w-3.5 text-[#37352F]" /> : null}
            </button>
          ) : null}
          {groupedModels.map((group) => (
            <div key={group.config.id} className="py-1">
              <div className="px-3 py-1 text-[11px] font-medium text-[#9B9A97]">
                {getConfigLabel(group.config)}
              </div>
              {group.models.map((model) => {
                const selected = isSameSelection(currentSelection, {
                  configId: group.config.id,
                  modelName: model.id
                })
                return (
                  <button
                    key={`${group.config.id}:${model.id}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={joinClassNames(
                      'workbench-select-option',
                      selected ? 'workbench-select-option-selected' : ''
                    )}
                    onClick={() => selectModel({ configId: group.config.id, modelName: model.id })}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <HiCpuChip className="h-3.5 w-3.5 shrink-0 text-[#787774]" />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#37352F]">
                        {model.label || model.id}
                      </span>
                    </span>
                    {selected ? <HiCheck className="h-3.5 w-3.5 text-[#37352F]" /> : null}
                  </button>
                )
              })}
            </div>
          ))}
          {groupedModels.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px] text-[#91918E]">暂无结果</div>
          ) : null}
        </div>
      </>
    )
  }

  return (
    <div
      ref={rootRef}
      className={joinClassNames('relative min-w-0', className)}
      data-workbench-select-root="true"
      data-testid={dataTestId}
    >
      <Tooltip title={tooltip}>
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          className={joinClassNames(
            'workbench-select-trigger workbench-select-trigger-compact workbench-composer-pill workbench-composer-model-pill',
            open ? 'workbench-select-trigger-open' : '',
            disabled ? 'workbench-select-trigger-disabled' : '',
            noDrag ? 'workbench-no-drag' : ''
          )}
          onClick={() => {
            if (disabled) return
            setOpen((current) => !current)
          }}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <HiCpuChip className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{mainLabel}</span>
            {value.visionModel ? (
              <span className="ml-1 inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-[#F4F4F2] px-1.5 text-[11px] font-semibold text-[#787774]">
                <HiPhoto className="h-3 w-3" />
                {visionInitial ? <span>{visionInitial}</span> : null}
              </span>
            ) : null}
          </span>
          <HiChevronRight
            className={joinClassNames(
              'h-3.5 w-3.5 shrink-0 transition-transform duration-150',
              open ? 'rotate-90' : ''
            )}
          />
        </button>
      </Tooltip>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={listboxId}
              role="listbox"
              className="workbench-select-menu workbench-composer-menu"
              data-workbench-select-root="true"
              style={{
                position: 'fixed',
                top: position.top,
                bottom: position.bottom,
                left: position.left,
                width: position.width,
                zIndex: 1000
              }}
            >
              {view === 'root' ? (
                <div className="py-1.5">
                  <button
                    type="button"
                    className="workbench-select-option min-h-[44px]"
                    onClick={() => setView('main')}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span className="text-[13px] font-semibold text-[#37352F]">主模型</span>
                      <Tooltip title="用于理解问题、生成回答、规划任务。">
                        <HiQuestionMarkCircle className="h-3.5 w-3.5 text-[#9B9A97]" />
                      </Tooltip>
                    </span>
                    <span className="min-w-0 truncate text-[13px] text-[#787774]">
                      {value.mainModel?.modelName || '未选择'}
                    </span>
                    <HiChevronRight className="h-3.5 w-3.5 shrink-0 text-[#9B9A97]" />
                  </button>
                  <button
                    type="button"
                    className="workbench-select-option min-h-[44px]"
                    onClick={() => setView('vision')}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span className="text-[13px] font-semibold text-[#37352F]">视觉模型</span>
                      <Tooltip title="用于识别图片。未选择时，会自动使用主模型。">
                        <HiQuestionMarkCircle className="h-3.5 w-3.5 text-[#9B9A97]" />
                      </Tooltip>
                    </span>
                    <span className="min-w-0 truncate text-[13px] text-[#787774]">
                      {value.visionModel?.modelName || '跟随主模型'}
                    </span>
                    <HiChevronRight className="h-3.5 w-3.5 shrink-0 text-[#9B9A97]" />
                  </button>
                </div>
              ) : (
                renderModelList()
              )}
            </div>,
            document.body
          )
        : null}
    </div>
  )
}

export default WorkbenchModelSelector
