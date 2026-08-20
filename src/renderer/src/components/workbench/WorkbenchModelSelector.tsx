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
  HiArrowPath,
  HiCheck,
  HiChevronDown,
  HiChevronLeft,
  HiChevronRight,
  HiCpuChip,
  HiMagnifyingGlass,
  HiQuestionMarkCircle,
  HiSparkles
} from 'react-icons/hi2'
import { PiEyesFill } from 'react-icons/pi'
import type {
  LLMConfig,
  LlmRemoteModel,
  WorkbenchModelSelection,
  WorkbenchSelectedModel
} from '../../../../shared/types'
import { resolveFloatingPlacement } from './floatingPlacement'
import { workbenchSelectors } from '../../testing/selectors'

type WorkbenchModelSelectorProps = {
  configs: LLMConfig[]
  modelListsByConfigId: Record<string, LlmRemoteModel[]>
  value: WorkbenchModelSelection
  onChange: (value: WorkbenchModelSelection) => void
  onAfterChange?: () => void
  disabled?: boolean
  noDrag?: boolean
  hideTriggerIcon?: boolean
  className?: string
  'data-testid'?: string
}

type PanelView = 'root' | 'main' | 'vision'

type VisionFilterMode = 'manual' | 'ai'

type AiVisionAnalysisState = {
  status: 'idle' | 'loading' | 'done' | 'error'
  modelNames: string[]
  error?: string
}

type MenuPosition = {
  top?: number
  bottom?: number
  left: number
  width: number
  maxHeight: number
}

const DEFAULT_POSITION: MenuPosition = {
  left: 0,
  width: 320,
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

const VISION_ANALYSIS_CACHE_PREFIX = 'ncurator:vision-model-analysis:'

const parseCachedVisionModelNames = (raw: string | null): string[] | null => {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    if (!parsed.every((entry) => typeof entry === 'string' && entry.trim())) return null
    return parsed.map((entry) => entry.trim())
  } catch {
    return null
  }
}

const WorkbenchModelSelector: React.FC<WorkbenchModelSelectorProps> = ({
  configs,
  modelListsByConfigId,
  value,
  onChange,
  onAfterChange,
  disabled = false,
  noDrag = false,
  hideTriggerIcon = false,
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
  const [collapsedConfigIds, setCollapsedConfigIds] = useState<Set<string>>(() => new Set())
  const [searchCollapsedConfigIds, setSearchCollapsedConfigIds] = useState<Set<string>>(
    () => new Set()
  )
  const [position, setPosition] = useState<MenuPosition>(DEFAULT_POSITION)
  const [visionFilterMode, setVisionFilterMode] = useState<VisionFilterMode>('manual')
  const [aiAnalysis, setAiAnalysis] = useState<AiVisionAnalysisState>({
    status: 'idle',
    modelNames: []
  })
  const aiAnalysisRequestIdRef = useRef(0)

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
      preferredWidth: 320,
      preferredHeight: 360,
      minWidth: 300,
      maxWidth: 360,
      maxHeight: 420,
      align: 'end'
    })
    setPosition({
      left: placement.left,
      top: placement.top,
      bottom: placement.bottom,
      width: placement.width,
      maxHeight: placement.maxHeight
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
      setVisionFilterMode('manual')
      return
    }
    if (view === 'root') return
    window.requestAnimationFrame(() => searchInputRef.current?.focus())
  }, [open, view])

  useEffect(() => {
    if (!query.trim()) setSearchCollapsedConfigIds(new Set())
  }, [query])

  const selectModel = (input: { configId: string; model: LlmRemoteModel }): void => {
    const model: WorkbenchSelectedModel = {
      configId: input.configId,
      modelName: input.model.id
    }
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

  const groupedModels = useMemo(() => {
    return configs
      .map((config) => {
        const models = (modelListsByConfigId[config.id] || []).filter((model) =>
          modelMatchesQuery({ query, config, model })
        )
        return { config, models }
      })
      .filter((group) => group.models.length > 0)
  }, [configs, modelListsByConfigId, query])

  const visionCandidateNames = useMemo(
    () =>
      Array.from(
        new Set(
          configs.flatMap((config) => (modelListsByConfigId[config.id] || []).map((model) => model.id))
        )
      ).sort(),
    [configs, modelListsByConfigId]
  )

  const analysisCacheKey = `${VISION_ANALYSIS_CACHE_PREFIX}${visionCandidateNames.join('\u0000')}`

  const readCachedAnalysis = useCallback((): string[] | null => {
    try {
      return parseCachedVisionModelNames(localStorage.getItem(analysisCacheKey))
    } catch {
      return null
    }
  }, [analysisCacheKey])

  const writeCachedAnalysis = useCallback(
    (modelNames: string[]): void => {
      try {
        localStorage.setItem(analysisCacheKey, JSON.stringify(modelNames))
      } catch {
        // ignore storage availability / quota errors
      }
    },
    [analysisCacheKey]
  )

  useEffect(() => {
    if (visionFilterMode !== 'ai' || aiAnalysis.status !== 'idle') return
    const cached = readCachedAnalysis()
    if (cached) setAiAnalysis({ status: 'done', modelNames: cached })
  }, [visionFilterMode, aiAnalysis.status, readCachedAnalysis])

  const runAiAnalysis = useCallback(async (): Promise<void> => {
    if (!value.mainModel) return
    const requestId = aiAnalysisRequestIdRef.current + 1
    aiAnalysisRequestIdRef.current = requestId
    setAiAnalysis({ status: 'loading', modelNames: [] })
    try {
      const response = await window.api.analyzeVisionModels({
        mainModel: value.mainModel,
        modelNames: visionCandidateNames
      })
      if (aiAnalysisRequestIdRef.current !== requestId) return
      if (!response.success) {
        setAiAnalysis({
          status: 'error',
          modelNames: [],
          error: response.error || '分析失败，请重试'
        })
        return
      }
      setAiAnalysis({ status: 'done', modelNames: response.modelNames })
      writeCachedAnalysis(response.modelNames)
    } catch (error) {
      if (aiAnalysisRequestIdRef.current !== requestId) return
      setAiAnalysis({
        status: 'error',
        modelNames: [],
        error: error instanceof Error ? error.message : '分析失败，请重试'
      })
    }
  }, [visionCandidateNames, value.mainModel, writeCachedAnalysis])

  const aiVisionGroups = useMemo(() => {
    const visionNames = new Set(aiAnalysis.modelNames)
    return configs
      .map((config) => ({
        config,
        models: (modelListsByConfigId[config.id] || []).filter((model) =>
          visionNames.has(model.id)
        )
      }))
      .filter((group) => group.models.length > 0)
  }, [aiAnalysis.modelNames, configs, modelListsByConfigId])

  const renderVisionTabs = (): React.ReactNode => (
    <div className="flex items-center gap-2 border-b border-[#EEEEEC] px-2.5 py-1.5">
      <div className="workbench-select-segment" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={visionFilterMode === 'manual'}
          data-testid={workbenchSelectors.modelSelectVisionManualTab}
          className={joinClassNames(
            'workbench-select-segment-item',
            visionFilterMode === 'manual' ? 'workbench-select-segment-item-active' : ''
          )}
          onClick={() => setVisionFilterMode('manual')}
        >
          手动选择
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={visionFilterMode === 'ai'}
          data-testid={workbenchSelectors.modelSelectVisionAiTab}
          className={joinClassNames(
            'workbench-select-segment-item',
            visionFilterMode === 'ai' ? 'workbench-select-segment-item-active' : ''
          )}
          onClick={() => setVisionFilterMode('ai')}
        >
          AI 筛选
        </button>
      </div>
      {visionFilterMode === 'ai' ? (
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            disabled={aiAnalysis.status === 'loading' || !value.mainModel}
            aria-label="重新分析视觉模型"
            data-testid={workbenchSelectors.modelSelectVisionAiRefresh}
            className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[#787774] hover:bg-[#F4F4F2] hover:text-[#37352F] disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => void runAiAnalysis()}
          >
            <HiArrowPath
              className={joinClassNames(
                'h-3.5 w-3.5',
                aiAnalysis.status === 'loading' ? 'animate-spin' : ''
              )}
            />
          </button>
          <Tooltip title="点击刷新会消耗少量 token；$ 代表价格成本，越多越贵">
            <span className="flex h-7 w-7 items-center justify-center">
              <HiQuestionMarkCircle className="h-3.5 w-3.5 text-[#9B9A97]" />
            </span>
          </Tooltip>
        </div>
      ) : null}
    </div>
  )

  const renderAiVisionList = (): React.ReactNode => {
    if (!value.mainModel) {
      return (
        <div className="px-4 py-8 text-center text-[12px] text-[#91918E]">
          请先选择主模型，再使用 AI 筛选
        </div>
      )
    }
    if (aiAnalysis.status === 'idle') {
      return (
        <div className="flex flex-col items-center gap-3 px-4 py-8">
          <div className="text-center text-[12px] text-[#91918E]">
            让主模型帮你找出支持视觉的模型
          </div>
          <button
            type="button"
            data-testid={workbenchSelectors.modelSelectVisionAiRun}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#37352F] px-3 text-[12px] font-medium text-white hover:bg-[#2F3437]"
            onClick={() => void runAiAnalysis()}
          >
            <HiSparkles className="h-3.5 w-3.5" />
            AI 分析
          </button>
        </div>
      )
    }
    if (aiAnalysis.status === 'loading') {
      return (
        <div className="flex items-center justify-center gap-2 px-4 py-8 text-[12px] text-[#91918E]">
          <HiArrowPath className="h-3.5 w-3.5 animate-spin" />
          正在分析模型…
        </div>
      )
    }
    if (aiAnalysis.status === 'error') {
      return (
        <div className="flex flex-col items-center gap-3 px-4 py-8">
          <div className="text-center text-[12px] text-[#91918E]">
            {aiAnalysis.error || '分析失败，请重试'}
          </div>
          <button
            type="button"
            data-testid={workbenchSelectors.modelSelectVisionAiRetry}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#E5E4E0] px-3 text-[12px] font-medium text-[#37352F] hover:bg-[#F4F4F2]"
            onClick={() => void runAiAnalysis()}
          >
            <HiArrowPath className="h-3.5 w-3.5" />
            重试
          </button>
        </div>
      )
    }
    if (aiVisionGroups.length === 0) {
      return (
        <div className="px-4 py-8 text-center text-[12px] text-[#91918E]">
          未识别到支持视觉的模型
        </div>
      )
    }
    return (
      <>
        {aiVisionGroups.map((group) => {
          const collapsed = collapsedConfigIds.has(group.config.id)
          const toggleCollapsed = (): void => {
            setCollapsedConfigIds((current) => {
              const next = new Set(current)
              if (next.has(group.config.id)) next.delete(group.config.id)
              else next.add(group.config.id)
              return next
            })
          }
          return (
            <div key={group.config.id} className="py-1">
              <button
                type="button"
                aria-expanded={!collapsed}
                className="flex w-full items-center px-3 py-1 text-left text-[11px] font-medium text-[#9B9A97] hover:text-[#37352F]"
                onClick={toggleCollapsed}
              >
                <span className="inline-flex items-center gap-1">
                  <span>{getConfigLabel(group.config)}</span>
                  {collapsed ? (
                    <HiChevronRight className="h-3 w-3 shrink-0" />
                  ) : (
                    <HiChevronDown className="h-3 w-3 shrink-0" />
                  )}
                </span>
              </button>
              {!collapsed
                ? group.models.map((model) => {
                    const selected = isSameSelection(value.visionModel, {
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
                        onClick={() => selectModel({ configId: group.config.id, model })}
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
                  })
                : null}
            </div>
          )
        })}
      </>
    )
  }

  const renderModelList = (): React.ReactNode => {
    const currentSelection = view === 'main' ? value.mainModel : value.visionModel
    const isVisionView = view === 'vision'
    const showAiFilter = isVisionView && visionFilterMode === 'ai'
    const showSearch = !showAiFilter
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
        {isVisionView ? renderVisionTabs() : null}
        {showSearch ? (
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
        ) : null}
        <div
          className="overflow-y-auto py-1.5"
          style={{ flex: 1, minHeight: 0 }}
        >
          {showAiFilter ? (
            renderAiVisionList()
          ) : (
            <>
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
              {groupedModels.map((group) => {
                const searching = Boolean(query.trim())
                const activeCollapsedIds = searching ? searchCollapsedConfigIds : collapsedConfigIds
                const collapsed = activeCollapsedIds.has(group.config.id)
                const toggleCollapsed = (): void => {
                  const setter = searching ? setSearchCollapsedConfigIds : setCollapsedConfigIds
                  setter((current) => {
                    const next = new Set(current)
                    if (next.has(group.config.id)) next.delete(group.config.id)
                    else next.add(group.config.id)
                    return next
                  })
                }
                return (
                  <div key={group.config.id} className="py-1">
                    <button
                      type="button"
                      aria-expanded={!collapsed}
                      className="flex w-full items-center px-3 py-1 text-left text-[11px] font-medium text-[#9B9A97] hover:text-[#37352F]"
                      onClick={toggleCollapsed}
                    >
                      <span className="inline-flex items-center gap-1">
                        <span>{getConfigLabel(group.config)}</span>
                        {collapsed ? (
                          <HiChevronRight className="h-3 w-3 shrink-0" />
                        ) : (
                          <HiChevronDown className="h-3 w-3 shrink-0" />
                        )}
                      </span>
                    </button>
                    {!collapsed
                      ? group.models.map((model) => {
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
                              onClick={() => selectModel({ configId: group.config.id, model })}
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
                        })
                      : null}
                  </div>
                )
              })}
              {groupedModels.length === 0 ? (
                <div className="px-4 py-6 text-center text-[12px] text-[#91918E]">暂无匹配模型</div>
              ) : null}
            </>
          )}
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
      <Tooltip title={tooltip} open={open ? false : undefined}>
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
            {!hideTriggerIcon ? <HiCpuChip className="h-3.5 w-3.5 shrink-0" /> : null}
            <span className="truncate">{mainLabel}</span>
            {value.visionModel ? (
              <span className="ml-1 inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-[#F4F4F2] px-1.5 text-[11px] font-semibold text-[#787774]">
                <PiEyesFill className="h-3 w-3" />
                {visionInitial ? <span>{visionInitial}</span> : null}
              </span>
            ) : null}
          </span>
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
                maxHeight: position.maxHeight,
                display: 'flex',
                flexDirection: 'column',
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
                    <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                      <span className="text-[13px] font-semibold text-[#37352F]">主模型</span>
                      <Tooltip title="用于理解问题、生成回答、规划任务。">
                        <HiQuestionMarkCircle className="h-3.5 w-3.5 shrink-0 text-[#9B9A97]" />
                      </Tooltip>
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-[#787774]">
                      {value.mainModel?.modelName || '未选择'}
                    </span>
                    <HiChevronRight className="h-3.5 w-3.5 shrink-0 text-[#9B9A97]" />
                  </button>
                  <button
                    type="button"
                    className="workbench-select-option min-h-[44px]"
                    onClick={() => setView('vision')}
                  >
                    <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                      <span className="text-[13px] font-semibold text-[#37352F]">视觉模型</span>
                      <Tooltip title="用于识别图片等视觉内容。并非所有模型都支持视觉，请选择正确的。">
                        <HiQuestionMarkCircle className="h-3.5 w-3.5 shrink-0 text-[#9B9A97]" />
                      </Tooltip>
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-[#787774]">
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
