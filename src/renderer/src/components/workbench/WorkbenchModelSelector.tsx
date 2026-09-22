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
import {
  HiAdjustmentsHorizontal,
  HiArrowPath,
  HiCheck,
  HiChevronDown,
  HiChevronLeft,
  HiChevronRight,
  HiCpuChip,
  HiMagnifyingGlass,
  HiXMark
} from 'react-icons/hi2'
import { PiCoinBold } from 'react-icons/pi'
import type {
  LLMConfig,
  LlmRemoteModel,
  WorkbenchModelSelection,
  WorkbenchSelectedModel
} from '../../../../shared/types'
import {
  PRESET_MODEL_CATALOG_TTL_MS,
  resolvePresetModeProvider,
  type LlmPresetModel,
  type LlmPresetProvider,
  type LlmPriceTier
} from '../../../../shared/llmPresets'
import {
  FREE_MODEL_NOTICE,
  FREE_MODEL_PRICE_LABEL,
  type FreeModelPublicEntry
} from '../../../../shared/freeModels'
import { resolveLlmProvider } from '../../../../shared/llmProvider'
import { isPresetModelAvailableInRemoteList } from '../../../../shared/workbenchModelSelection'
import { resolveFloatingPlacement } from './floatingPlacement'
import { WORKBENCH_TITLEBAR_HEIGHT } from './constants'
import { getProviderLogo } from '../settings/constants'
import { workbenchSelectors } from '../../testing/selectors'

const PRICE_TIER_LABELS: Record<LlmPriceTier, string> = {
  low: '较低',
  mid: '适中',
  high: '较高'
}

const PRICE_TIER_COIN_COUNT: Record<LlmPriceTier, number> = {
  low: 1,
  mid: 2,
  high: 3
}

type WorkbenchModelSelectorProps = {
  configs: LLMConfig[]
  modelListsByConfigId: Record<string, LlmRemoteModel[]>
  value: WorkbenchModelSelection
  onChange: (value: WorkbenchModelSelection) => void
  onAfterChange?: () => void
  onRefreshModelLists?: () => void | Promise<void>
  onFreeModelsChange?: (models: FreeModelPublicEntry[]) => void
  disabled?: boolean
  noDrag?: boolean
  hideTriggerIcon?: boolean
  variant?: 'composer' | 'form'
  className?: string
  'data-testid'?: string
}

type PanelView = 'preset' | 'custom'

type CatalogLoadStatus = 'loading' | 'ready' | 'error'
type CatalogRefreshStatus = 'idle' | 'loading' | 'success' | 'error'

type PresetInspector = {
  kind: 'preset'
  provider: LlmPresetProvider
  model: LlmPresetModel
  available: boolean
  top: number
}

type FreeInspector = {
  kind: 'free'
  model: FreeModelPublicEntry
  top: number
}

type ModelInspector = PresetInspector | FreeInspector

type MenuPosition = {
  top?: number
  bottom?: number
  left: number
  width: number
  maxHeight: number
}

const PRESET_MENU_MIN_WIDTH = 200
const PRESET_MENU_MAX_WIDTH = 300
const CUSTOM_MENU_MIN_WIDTH = 280
const CUSTOM_MENU_MAX_WIDTH = 360
const PRESET_LIST_MAX_HEIGHT = 300
const INSPECTOR_WIDTH = 200
const INSPECTOR_GAP = 1
const INSPECTOR_FALLBACK_HEIGHT = 168
const VIEWPORT_PADDING = 12

const clampInspectorTop = (rowTop: number, height: number): number => {
  const maxTop = window.innerHeight - VIEWPORT_PADDING - Math.max(1, height)
  return Math.min(Math.max(rowTop, VIEWPORT_PADDING), Math.max(VIEWPORT_PADDING, maxTop))
}
const CATALOG_REFRESH_FEEDBACK_MS = 1400
const DEFAULT_POSITION: MenuPosition = {
  left: 0,
  width: PRESET_MENU_MIN_WIDTH,
  maxHeight: 360
}

const joinClassNames = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(' ')

const getConfigLabel = (config: LLMConfig | null | undefined): string =>
  config?.name?.trim() || config?.base_url?.trim() || '模型配置'

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

const isCatalogFetchedAtStale = (fetchedAt: number | null | undefined, now = Date.now()): boolean =>
  typeof fetchedAt !== 'number' || now - fetchedAt >= PRESET_MODEL_CATALOG_TTL_MS

const PRICE_TIER_COIN_SIZE = 12
const PRICE_TIER_COIN_STEP = 4
const PRICE_TIER_COIN_GAP_PX = 2
const PRICE_TIER_TEXT_LINE_PX = 13

const PriceTierCoins: React.FC<{ tier: LlmPriceTier }> = ({ tier }) => {
  const count = PRICE_TIER_COIN_COUNT[tier]
  return (
    <span
      aria-label={`价格档位 ${PRICE_TIER_LABELS[tier]}`}
      className="relative top-[2px] inline-block shrink-0 overflow-visible"
      style={{ width: PRICE_TIER_COIN_SIZE, height: PRICE_TIER_TEXT_LINE_PX }}
    >
      {Array.from({ length: count }, (_, index) => (
        <PiCoinBold
          key={index}
          className="pointer-events-none absolute left-0 block text-[#9B9A97]"
          style={{
            width: PRICE_TIER_COIN_SIZE,
            height: PRICE_TIER_COIN_SIZE,
            bottom: index * PRICE_TIER_COIN_STEP,
            zIndex: index + 1
          }}
        />
      ))}
    </span>
  )
}

const CatalogModelIcon: React.FC<{ src: string; alt: string }> = ({ src, alt }) => (
  <img src={src} alt={alt} className="h-4 w-4 shrink-0 rounded-[3px] object-contain" />
)

const WorkbenchModelSelector: React.FC<WorkbenchModelSelectorProps> = ({
  configs,
  modelListsByConfigId,
  value,
  onChange,
  onAfterChange,
  onRefreshModelLists,
  onFreeModelsChange,
  disabled = false,
  noDrag = false,
  hideTriggerIcon = false,
  variant = 'composer',
  className,
  'data-testid': dataTestId
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const inspectorRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const refreshFeedbackTimerRef = useRef<number | null>(null)
  const listboxId = useId()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<PanelView>('preset')
  const [query, setQuery] = useState('')
  const [collapsedConfigIds, setCollapsedConfigIds] = useState<Set<string>>(() => new Set())
  const [searchCollapsedConfigIds, setSearchCollapsedConfigIds] = useState<Set<string>>(
    () => new Set()
  )
  const [position, setPosition] = useState<MenuPosition>(DEFAULT_POSITION)
  const [inspectedModel, setInspectedModel] = useState<ModelInspector | null>(null)
  const [inspectorTop, setInspectorTop] = useState(0)
  const [freeModels, setFreeModels] = useState<FreeModelPublicEntry[]>([])
  const [presetProviders, setPresetProviders] = useState<LlmPresetProvider[]>([])
  const [freeFetchedAt, setFreeFetchedAt] = useState<number | null>(null)
  const [presetFetchedAt, setPresetFetchedAt] = useState<number | null>(null)
  const [catalogLoadStatus, setCatalogLoadStatus] = useState<CatalogLoadStatus>('loading')
  const [catalogRefreshStatus, setCatalogRefreshStatus] = useState<CatalogRefreshStatus>('idle')

  const clearRefreshFeedbackTimer = useCallback((): void => {
    if (refreshFeedbackTimerRef.current !== null) {
      window.clearTimeout(refreshFeedbackTimerRef.current)
      refreshFeedbackTimerRef.current = null
    }
  }, [])

  const scheduleRefreshIdle = useCallback((): void => {
    clearRefreshFeedbackTimer()
    refreshFeedbackTimerRef.current = window.setTimeout(() => {
      setCatalogRefreshStatus('idle')
      refreshFeedbackTimerRef.current = null
    }, CATALOG_REFRESH_FEEDBACK_MS)
  }, [clearRefreshFeedbackTimer])

  const applyCatalogSnapshots = useCallback(
    (input: {
      freeModels: FreeModelPublicEntry[]
      freeFetchedAt: number | null
      presetProviders: LlmPresetProvider[]
      presetFetchedAt: number | null
    }): boolean => {
      setFreeModels(input.freeModels)
      onFreeModelsChange?.(input.freeModels)
      setFreeFetchedAt(input.freeFetchedAt)
      if (input.presetProviders.length > 0) {
        setPresetProviders(input.presetProviders)
      }
      setPresetFetchedAt(input.presetFetchedAt)
      return input.freeModels.length > 0 || input.presetProviders.length > 0
    },
    [onFreeModelsChange]
  )

  const loadCatalogFromCache = useCallback(
    async (refreshIfStale: boolean): Promise<boolean> => {
      const [freeSnapshot, presetSnapshot] = await Promise.all([
        window.api.freeModelsGet({ refreshIfStale }),
        window.api.presetModelsGet({ refreshIfStale })
      ])
      return applyCatalogSnapshots({
        freeModels: freeSnapshot.models,
        freeFetchedAt: freeSnapshot.fetchedAt,
        presetProviders: presetSnapshot.providers,
        presetFetchedAt: presetSnapshot.fetchedAt
      })
    },
    [applyCatalogSnapshots]
  )

  const refreshCatalog = useCallback(
    async (options?: { showOutcome?: boolean }): Promise<boolean> => {
      const showOutcome = options?.showOutcome ?? true
      clearRefreshFeedbackTimer()
      setCatalogRefreshStatus('loading')
      try {
        const [freeResult, presetResult] = await Promise.all([
          window.api.freeModelsRefresh(),
          window.api.presetModelsRefresh()
        ])
        const hasData = applyCatalogSnapshots({
          freeModels: freeResult.snapshot.models,
          freeFetchedAt: freeResult.snapshot.fetchedAt,
          presetProviders: presetResult.snapshot.providers,
          presetFetchedAt: presetResult.snapshot.fetchedAt
        })
        const ok = freeResult.success && presetResult.success
        if (showOutcome) {
          setCatalogRefreshStatus(ok ? 'success' : 'error')
          scheduleRefreshIdle()
        } else {
          setCatalogRefreshStatus('idle')
        }
        if (hasData) {
          setCatalogLoadStatus('ready')
        } else if (!ok) {
          setCatalogLoadStatus('error')
        } else {
          setCatalogLoadStatus('ready')
        }
        return ok
      } catch (error) {
        console.error('Failed to refresh model catalogs', error)
        if (showOutcome) {
          setCatalogRefreshStatus('error')
          scheduleRefreshIdle()
        } else {
          setCatalogRefreshStatus('idle')
        }
        setCatalogLoadStatus((current) => {
          if (current === 'ready') return current
          return freeModels.length > 0 || presetProviders.length > 0 ? 'ready' : 'error'
        })
        return false
      }
    },
    [
      applyCatalogSnapshots,
      clearRefreshFeedbackTimer,
      freeModels.length,
      presetProviders.length,
      scheduleRefreshIdle
    ]
  )

  useEffect(() => {
    let cancelled = false
    const bootstrap = async (): Promise<void> => {
      try {
        const hasCache = await loadCatalogFromCache(false)
        if (cancelled) return
        if (hasCache) {
          setCatalogLoadStatus('ready')
          return
        }
        setCatalogLoadStatus('loading')
        await refreshCatalog({ showOutcome: false })
      } catch (error) {
        console.error('Failed to load model catalogs', error)
        if (!cancelled) setCatalogLoadStatus('error')
      }
    }
    void bootstrap()
    return () => {
      cancelled = true
      clearRefreshFeedbackTimer()
    }
    // Intentionally mount-once bootstrap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!open || view !== 'preset') return
    let cancelled = false
    const syncOnOpen = async (): Promise<void> => {
      const hasData = freeModels.length > 0 || presetProviders.length > 0
      if (!hasData) {
        setCatalogLoadStatus('loading')
        await refreshCatalog({ showOutcome: false })
        return
      }
      const stale =
        isCatalogFetchedAtStale(freeFetchedAt) || isCatalogFetchedAtStale(presetFetchedAt)
      if (!stale) return
      if (cancelled) return
      await refreshCatalog({ showOutcome: false })
    }
    void syncOnOpen()
    return () => {
      cancelled = true
    }
    // Only re-run when the menu opens on the preset view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view])

  const mainLabel = value.mainModel?.modelName || '选择模型'

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const preferredWidth = view === 'custom' ? 320 : 240
    const placement = resolveFloatingPlacement({
      triggerRect: rect,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      preferredWidth,
      preferredHeight: 320,
      minWidth: view === 'custom' ? CUSTOM_MENU_MIN_WIDTH : PRESET_MENU_MIN_WIDTH,
      maxWidth: view === 'custom' ? CUSTOM_MENU_MAX_WIDTH : PRESET_MENU_MAX_WIDTH,
      maxHeight: 360,
      align: 'end',
      topInset: WORKBENCH_TITLEBAR_HEIGHT + 12
    })
    setPosition({
      left: placement.left,
      top: placement.top,
      bottom: placement.bottom,
      width: placement.width,
      maxHeight: placement.maxHeight
    })
  }, [view])

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
  }, [open, updatePosition, view])

  useLayoutEffect(() => {
    if (!open || !menuRef.current || !triggerRef.current) return
    const menu = menuRef.current
    const previousWidth = menu.style.width
    menu.style.width = 'max-content'
    const measured = Math.ceil(menu.getBoundingClientRect().width)
    menu.style.width = previousWidth
    const minWidth = view === 'custom' ? CUSTOM_MENU_MIN_WIDTH : PRESET_MENU_MIN_WIDTH
    const maxWidth = view === 'custom' ? CUSTOM_MENU_MAX_WIDTH : PRESET_MENU_MAX_WIDTH
    const nextWidth = Math.min(Math.max(measured, minWidth), maxWidth)
    const rect = triggerRef.current.getBoundingClientRect()
    const placement = resolveFloatingPlacement({
      triggerRect: rect,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      preferredWidth: nextWidth,
      preferredHeight: 320,
      minWidth,
      maxWidth,
      maxHeight: 360,
      align: 'end',
      topInset: WORKBENCH_TITLEBAR_HEIGHT + 12
    })
    let nextLeft = placement.left
    // Keep the inspector fixed to the menu's right. If the pair would overflow,
    // shift the menu left so both stay in viewport.
    if (view === 'preset' && inspectedModel) {
      const pairWidth = nextWidth + INSPECTOR_GAP + INSPECTOR_WIDTH
      const maxLeft = Math.max(
        VIEWPORT_PADDING,
        window.innerWidth - VIEWPORT_PADDING - pairWidth
      )
      nextLeft = Math.min(nextLeft, maxLeft)
    }
    if (
      Math.abs(nextWidth - position.width) < 1 &&
      Math.abs(nextLeft - position.left) < 1 &&
      placement.top === position.top &&
      placement.bottom === position.bottom
    ) {
      return
    }
    setPosition({
      left: nextLeft,
      top: placement.top,
      bottom: placement.bottom,
      width: nextWidth,
      maxHeight: placement.maxHeight
    })
  }, [open, view, position, inspectedModel, query, configs, modelListsByConfigId, freeModels, presetProviders])

  useLayoutEffect(() => {
    if (!open || !inspectedModel) {
      setInspectorTop(0)
      return
    }
    const height = inspectorRef.current?.offsetHeight || INSPECTOR_FALLBACK_HEIGHT
    setInspectorTop(clampInspectorTop(inspectedModel.top, height))
  }, [open, inspectedModel])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      if (inspectorRef.current?.contains(target)) return
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
      setView('preset')
      setQuery('')
      setInspectedModel(null)
      return
    }
    if (view === 'preset') return
    window.requestAnimationFrame(() => searchInputRef.current?.focus())
  }, [open, view])

  useEffect(() => {
    if (!query.trim()) setSearchCollapsedConfigIds(new Set())
  }, [query])

  const selectModel = (configId: string, modelName: string): void => {
    onChange({ mainModel: { configId, modelName } })
    setOpen(false)
    onAfterChange?.()
  }

  const presetGroups = useMemo(
    () =>
      presetProviders.flatMap((provider) => {
        const matchedConfig = configs.find(
          (config) => resolvePresetModeProvider(config)?.providerId === provider.providerId
        )
        return matchedConfig ? [{ provider, matchedConfig }] : []
      }),
    [configs, presetProviders]
  )

  const selectedPreset = useMemo(() => {
    if (!value.mainModel) return null
    const config = configs.find((item) => item.id === value.mainModel?.configId)
    const preset = config ? resolvePresetModeProvider(config) : null
    if (!preset) return null
    const model = presetProviders
      .find((provider) => provider.providerId === preset.providerId)
      ?.models.find((item) => item.id === value.mainModel?.modelName)
    if (!model) return null
    return { provider: preset, modelLabel: model.label, iconUrl: model.iconUrl }
  }, [value.mainModel, configs, presetProviders])

  const selectedFree = useMemo(() => {
    if (!value.mainModel) return null
    return (
      freeModels.find(
        (item) =>
          item.configId === value.mainModel?.configId &&
          item.modelName === value.mainModel?.modelName
      ) || null
    )
  }, [value.mainModel, freeModels])

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

  const renderPresetModelOption = (
    provider: LlmPresetProvider,
    model: LlmPresetModel,
    matchedConfig: LLMConfig
  ): React.ReactNode => {
    const remoteModels = modelListsByConfigId[matchedConfig.id] || []
    const available = isPresetModelAvailableInRemoteList(model.id, remoteModels)
    const selected = isSameSelection(value.mainModel, {
      configId: matchedConfig.id,
      modelName: model.id
    })
    return (
      <button
        key={`${provider.providerId}:${model.id}`}
        type="button"
        role="option"
        aria-selected={selected}
        aria-disabled={!available}
        data-testid={`${workbenchSelectors.modelSelectPresetOptionPrefix}-${model.id}`}
        className={joinClassNames(
          'workbench-select-option',
          selected ? 'workbench-select-option-selected' : '',
          !available ? 'workbench-select-option-disabled' : ''
        )}
        onClick={() => {
          if (!available) return
          selectModel(matchedConfig.id, model.id)
        }}
        onMouseEnter={(event) =>
          setInspectedModel({
            kind: 'preset',
            provider,
            model,
            available,
            top: event.currentTarget.getBoundingClientRect().top
          })
        }
        onFocus={(event) =>
          setInspectedModel({
            kind: 'preset',
            provider,
            model,
            available,
            top: event.currentTarget.getBoundingClientRect().top
          })
        }
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <CatalogModelIcon src={model.iconUrl} alt={model.label} />
          <span className="inline-flex items-end" style={{ gap: PRICE_TIER_COIN_GAP_PX }}>
            <span
              className="whitespace-nowrap text-[13px] font-medium text-[#37352F]"
              style={{ lineHeight: `${PRICE_TIER_TEXT_LINE_PX}px` }}
            >
              {model.label}
            </span>
            <PriceTierCoins tier={model.priceTier} />
          </span>
        </span>
        {selected ? <HiCheck className="h-3.5 w-3.5 shrink-0 text-[#37352F]" /> : null}
      </button>
    )
  }

  const renderFreeModelOption = (model: FreeModelPublicEntry): React.ReactNode => {
    const selected = isSameSelection(value.mainModel, {
      configId: model.configId,
      modelName: model.modelName
    })
    return (
      <button
        key={model.id}
        type="button"
        role="option"
        aria-selected={selected}
        data-testid={`${workbenchSelectors.modelSelectFreeOptionPrefix}-${model.id}`}
        className={joinClassNames(
          'workbench-select-option',
          selected ? 'workbench-select-option-selected' : ''
        )}
        onClick={() => selectModel(model.configId, model.modelName)}
        onMouseEnter={(event) =>
          setInspectedModel({
            kind: 'free',
            model,
            top: event.currentTarget.getBoundingClientRect().top
          })
        }
        onFocus={(event) =>
          setInspectedModel({
            kind: 'free',
            model,
            top: event.currentTarget.getBoundingClientRect().top
          })
        }
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <CatalogModelIcon src={model.iconUrl} alt={model.label} />
          <span
            className="inline-flex items-end gap-1.5"
            style={{ lineHeight: `${PRICE_TIER_TEXT_LINE_PX}px` }}
          >
            <span className="whitespace-nowrap text-[13px] font-medium text-[#37352F]">
              {model.label}
            </span>
            <span className="relative top-[1px] text-[11px] font-medium leading-none text-[#9B9A97]">
              {FREE_MODEL_PRICE_LABEL}
            </span>
          </span>
        </span>
        {selected ? <HiCheck className="h-3.5 w-3.5 shrink-0 text-[#37352F]" /> : null}
      </button>
    )
  }

  const renderCatalogRefreshButton = (): React.ReactNode => {
    const busy = catalogRefreshStatus === 'loading'
    const iconClass = joinClassNames(
      'h-3.5 w-3.5 transition-opacity duration-150',
      catalogRefreshStatus === 'loading' ? 'animate-spin' : ''
    )
    return (
      <button
        type="button"
        aria-label="刷新模型目录"
        data-testid={workbenchSelectors.modelSelectCatalogRefresh}
        disabled={busy}
        className="flex h-6 w-6 items-center justify-center rounded-[6px] text-[#9B9A97] hover:bg-[#F4F4F2] hover:text-[#37352F] disabled:pointer-events-none"
        onClick={(event) => {
          event.stopPropagation()
          void refreshCatalog({ showOutcome: true })
        }}
      >
        {catalogRefreshStatus === 'success' ? (
          <HiCheck className={joinClassNames(iconClass, 'text-[#356b5a]')} />
        ) : catalogRefreshStatus === 'error' ? (
          <HiXMark className={joinClassNames(iconClass, 'text-[#B3261E]')} />
        ) : (
          <HiArrowPath className={iconClass} />
        )}
      </button>
    )
  }

  const renderPresetView = (): React.ReactNode => {
    const showLoading = catalogLoadStatus === 'loading'
    const showError =
      catalogLoadStatus === 'error' &&
      presetGroups.length === 0 &&
      freeModels.length === 0
    const showEmpty =
      catalogLoadStatus === 'ready' &&
      presetGroups.length === 0 &&
      freeModels.length === 0

    return (
      <>
        <div className="relative min-h-0 flex-1">
          <div className="pointer-events-none absolute right-1.5 top-1.5 z-10">
            <div className="pointer-events-auto rounded-[6px] bg-white/90 backdrop-blur-[2px]">
              {renderCatalogRefreshButton()}
            </div>
          </div>
          <div
            className="overflow-y-auto py-1.5"
            style={{ maxHeight: PRESET_LIST_MAX_HEIGHT, minHeight: 0 }}
          >
            {showLoading ? (
              <div className="flex flex-col items-center px-4 py-6 text-center text-[12px] text-[#91918E]">
                正在加载模型目录…
              </div>
            ) : showError ? (
              <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
                <div className="text-[12px] text-[#91918E]">模型目录加载失败</div>
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#E5E4E0] px-3 text-[12px] font-medium text-[#37352F] hover:bg-[#F4F4F2]"
                  onClick={(event) => {
                    event.stopPropagation()
                    void refreshCatalog({ showOutcome: true })
                  }}
                >
                  <HiArrowPath
                    className={joinClassNames(
                      'h-3.5 w-3.5',
                      catalogRefreshStatus === 'loading' ? 'animate-spin' : ''
                    )}
                  />
                  刷新
                </button>
              </div>
            ) : showEmpty ? (
              <div className="flex flex-col items-center px-4 py-6 text-center text-[12px] text-[#91918E]">
                暂无已配置的预设模型
              </div>
            ) : (
              <>
                {presetGroups.map(({ provider, matchedConfig }) =>
                  provider.models.map((model) =>
                    renderPresetModelOption(provider, model, matchedConfig)
                  )
                )}
                {freeModels.length > 0 ? (
                  <div
                    className={presetGroups.length > 0 ? 'mt-1 border-t border-[#EEEEEC] pt-1' : ''}
                  >
                    {freeModels.map((model) => renderFreeModelOption(model))}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
        <div className="border-t border-[#EEEEEC] py-1.5">
          <button
            type="button"
            className="workbench-select-option min-h-[44px]"
            data-testid={workbenchSelectors.modelSelectCustomEntry}
            onClick={() => {
              setInspectedModel(null)
              setView('custom')
            }}
            onMouseEnter={() => setInspectedModel(null)}
          >
            <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
              <HiAdjustmentsHorizontal className="h-3.5 w-3.5 shrink-0 text-[#787774]" />
              <span className="text-[13px] font-semibold text-[#37352F]">自定义模型</span>
            </span>
            <span className="min-w-0 flex-1" />
            <HiChevronRight className="h-3.5 w-3.5 shrink-0 text-[#9B9A97]" />
          </button>
        </div>
      </>
    )
  }

  const renderCustomView = (): React.ReactNode => (
    <>
      <div className="flex items-center gap-2 border-b border-[#EEEEEC] px-2.5 py-2">
        <button
          type="button"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[#787774] hover:bg-[#F4F4F2] hover:text-[#37352F]"
          onClick={() => {
            setView('preset')
            setQuery('')
          }}
        >
          <HiChevronLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1 text-[13px] font-semibold text-[#37352F]">选择模型</div>
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
      <div className="overflow-y-auto py-1.5" style={{ flex: 1, minHeight: 0 }}>
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
                    const selected = isSameSelection(value.mainModel, {
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
                        onClick={() => selectModel(group.config.id, model.id)}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {getProviderLogo(resolveLlmProvider(group.config.base_url).providerId)}
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
          <div className="flex flex-col items-center px-4 py-6 text-center text-[12px] text-[#91918E]">
            <div>暂无匹配模型</div>
            {onRefreshModelLists ? (
              <button
                type="button"
                className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#E5E4E0] px-3 text-[12px] font-medium text-[#37352F] hover:bg-[#F4F4F2]"
                onClick={() => void onRefreshModelLists()}
              >
                <HiArrowPath className="h-3.5 w-3.5" />
                重新获取模型列表
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  )

  const inspectorLeft = position.left + position.width + INSPECTOR_GAP

  const renderInspector = (): React.ReactNode => {
    if (view !== 'preset' || !inspectedModel) return null
    if (inspectedModel.kind === 'free') {
      const supportsVision = inspectedModel.model.capabilities.includes('vision')
      return (
        <div
          ref={inspectorRef}
          data-testid={workbenchSelectors.inspector}
          className="rounded-[12px] border border-[#E5E4E0] bg-white px-3 py-3"
          style={{
            position: 'fixed',
            top: inspectorTop,
            left: inspectorLeft,
            width: INSPECTOR_WIDTH,
            zIndex: 1001
          }}
        >
          <div
            data-testid={workbenchSelectors.inspectorTitle}
            className="text-[14px] font-semibold text-[#252521]"
          >
            {inspectedModel.model.label}
          </div>
          <p className="mt-1.5 text-[12px] leading-[18px] text-[#5F5E5A]">
            {inspectedModel.model.description}
          </p>
          <p className="mt-1.5 text-[12px] leading-[18px] text-[#9B9A97]">{FREE_MODEL_NOTICE}</p>
          <div className="mt-2.5 border-t border-[#EEEEEC] pt-2.5 text-[12px]">
            <div className="flex items-center justify-between gap-3 py-0.5">
              <span className="shrink-0 text-[#9B9A97]">价格档位</span>
              <span className="font-medium text-[#37352F]">{FREE_MODEL_PRICE_LABEL}</span>
            </div>
            <div className="flex items-center justify-between gap-3 py-0.5">
              <span className="shrink-0 text-[#9B9A97]">视觉理解</span>
              <span className="font-medium text-[#37352F]">
                {supportsVision ? '支持' : '不支持'}
              </span>
            </div>
          </div>
        </div>
      )
    }

    const supportsVision = inspectedModel.model.capabilities.includes('vision')
    return (
      <div
        ref={inspectorRef}
        data-testid={workbenchSelectors.inspector}
        className="rounded-[12px] border border-[#E5E4E0] bg-white px-3 py-3"
        style={{
          position: 'fixed',
          top: inspectorTop,
          left: inspectorLeft,
          width: INSPECTOR_WIDTH,
          zIndex: 1001
        }}
      >
        <div
          data-testid={workbenchSelectors.inspectorTitle}
          className="text-[14px] font-semibold text-[#252521]"
        >
          {inspectedModel.model.label}
        </div>
        {inspectedModel.available ? (
          <>
            <p className="mt-1.5 text-[12px] leading-[18px] text-[#5F5E5A]">
              {inspectedModel.model.description}
            </p>
            <div className="mt-2.5 border-t border-[#EEEEEC] pt-2.5 text-[12px]">
              <div className="flex items-center justify-between gap-3 py-0.5">
                <span className="shrink-0 text-[#9B9A97]">价格档位</span>
                <span className="font-medium text-[#37352F]">
                  {PRICE_TIER_LABELS[inspectedModel.model.priceTier]}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 py-0.5">
                <span className="shrink-0 text-[#9B9A97]">视觉理解</span>
                <span className="font-medium text-[#37352F]">
                  {supportsVision ? '支持' : '不支持'}
                </span>
              </div>
            </div>
          </>
        ) : (
          <div className="mt-2.5 border-t border-[#EEEEEC] pt-2.5 text-[12px] leading-[18px] text-[#5F5E5A]">
            <div>该模型不存在</div>
            <div className="mt-1.5 break-all text-[#9B9A97]">
              模型名：{inspectedModel.model.id}
            </div>
          </div>
        )}
      </div>
    )
  }

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
          variant === 'form'
            ? 'workbench-select-trigger w-full'
            : 'workbench-select-trigger workbench-select-trigger-compact workbench-composer-pill workbench-composer-model-pill',
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
          {selectedPreset ? (
            <>
              <CatalogModelIcon src={selectedPreset.iconUrl} alt={selectedPreset.modelLabel} />
              <span className="truncate">{selectedPreset.modelLabel}</span>
            </>
          ) : selectedFree ? (
            <>
              <CatalogModelIcon src={selectedFree.iconUrl} alt={selectedFree.label} />
              <span className="truncate">{selectedFree.label}</span>
              <span className="shrink-0 text-[11px] font-medium text-[#9B9A97]">
                {FREE_MODEL_PRICE_LABEL}
              </span>
            </>
          ) : (
            <>
              {!hideTriggerIcon ? <HiCpuChip className="h-3.5 w-3.5 shrink-0" /> : null}
              <span className="truncate">{mainLabel}</span>
            </>
          )}
        </span>
        {variant === 'form' ? (
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
            <>
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
                {view === 'preset' ? renderPresetView() : renderCustomView()}
              </div>
              {renderInspector()}
            </>,
            document.body
          )
        : null}
    </div>
  )
}

export default WorkbenchModelSelector
