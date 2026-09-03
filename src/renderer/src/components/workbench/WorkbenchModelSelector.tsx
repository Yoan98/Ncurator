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
  HiMagnifyingGlass
} from 'react-icons/hi2'
import { FaSackDollar } from 'react-icons/fa6'
import type {
  LLMConfig,
  LlmRemoteModel,
  WorkbenchModelSelection,
  WorkbenchSelectedModel
} from '../../../../shared/types'
import {
  LLM_PRESET_PROVIDERS,
  resolvePresetModeProvider,
  type LlmPresetModel,
  type LlmPresetProvider,
  type LlmPriceTier
} from '../../../../shared/llmPresets'
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
  disabled?: boolean
  noDrag?: boolean
  hideTriggerIcon?: boolean
  variant?: 'composer' | 'form'
  className?: string
  'data-testid'?: string
}

type PanelView = 'preset' | 'custom'

type PresetInspector = {
  provider: LlmPresetProvider
  model: LlmPresetModel
  available: boolean
  top: number
}

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
const INSPECTOR_WIDTH = 200
const INSPECTOR_GAP = 1
const VIEWPORT_PADDING = 12
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

const PriceTierCoins: React.FC<{ tier: LlmPriceTier }> = ({ tier }) => {
  const count = PRICE_TIER_COIN_COUNT[tier]
  return (
    <span
      className="inline-flex shrink-0 items-center gap-0.5"
      aria-label={`价格档位 ${PRICE_TIER_LABELS[tier]}`}
    >
      {Array.from({ length: count }, (_, index) => (
        <FaSackDollar key={index} className="h-3 w-3 text-[#9B9A97]" />
      ))}
    </span>
  )
}

const WorkbenchModelSelector: React.FC<WorkbenchModelSelectorProps> = ({
  configs,
  modelListsByConfigId,
  value,
  onChange,
  onAfterChange,
  onRefreshModelLists,
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
  const listboxId = useId()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<PanelView>('preset')
  const [query, setQuery] = useState('')
  const [collapsedConfigIds, setCollapsedConfigIds] = useState<Set<string>>(() => new Set())
  const [searchCollapsedConfigIds, setSearchCollapsedConfigIds] = useState<Set<string>>(
    () => new Set()
  )
  const [position, setPosition] = useState<MenuPosition>(DEFAULT_POSITION)
  const [inspectedPreset, setInspectedPreset] = useState<PresetInspector | null>(null)

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
    if (view === 'preset' && inspectedPreset) {
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
  }, [open, view, position, inspectedPreset, query, configs, modelListsByConfigId])

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
      setInspectedPreset(null)
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
      LLM_PRESET_PROVIDERS.flatMap((provider) => {
        const matchedConfig = configs.find(
          (config) => resolvePresetModeProvider(config)?.providerId === provider.providerId
        )
        return matchedConfig ? [{ provider, matchedConfig }] : []
      }),
    [configs]
  )

  const selectedPreset = useMemo(() => {
    if (!value.mainModel) return null
    const config = configs.find((item) => item.id === value.mainModel?.configId)
    const preset = config ? resolvePresetModeProvider(config) : null
    if (!preset) return null
    const model = LLM_PRESET_PROVIDERS.find(
      (provider) => provider.providerId === preset.providerId
    )?.models.find((item) => item.id === value.mainModel?.modelName)
    if (!model) return null
    return { provider: preset, modelLabel: model.label }
  }, [value.mainModel, configs])

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
          setInspectedPreset({
            provider,
            model,
            available,
            top: event.currentTarget.getBoundingClientRect().top
          })
        }
        onFocus={(event) =>
          setInspectedPreset({
            provider,
            model,
            available,
            top: event.currentTarget.getBoundingClientRect().top
          })
        }
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {getProviderLogo(provider.providerId)}
          <span className="whitespace-nowrap text-[13px] font-medium text-[#37352F]">
            {model.label}
          </span>
          <PriceTierCoins tier={model.priceTier} />
        </span>
        {selected ? <HiCheck className="h-3.5 w-3.5 shrink-0 text-[#37352F]" /> : null}
      </button>
    )
  }

  const renderPresetView = (): React.ReactNode => (
    <>
      <div className="overflow-y-auto py-1.5" style={{ flex: 1, minHeight: 0 }}>
        {presetGroups.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-6 text-center text-[12px] text-[#91918E]">
            暂无已配置的预设模型
          </div>
        ) : (
          presetGroups.map(({ provider, matchedConfig }) =>
            provider.models.map((model) => renderPresetModelOption(provider, model, matchedConfig))
          )
        )}
      </div>
      <div className="border-t border-[#EEEEEC] py-1.5">
        <button
          type="button"
          className="workbench-select-option min-h-[44px]"
          data-testid={workbenchSelectors.modelSelectCustomEntry}
          onClick={() => {
            setInspectedPreset(null)
            setView('custom')
          }}
          onMouseEnter={() => setInspectedPreset(null)}
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

  const inspectorTop = inspectedPreset?.top ?? 0
  const inspectorLeft = position.left + position.width + INSPECTOR_GAP

  const renderInspector = (): React.ReactNode => {
    if (view !== 'preset' || !inspectedPreset) return null
    const supportsVision = inspectedPreset.model.capabilities.includes('vision')
    return (
      <div
        ref={inspectorRef}
        className="rounded-[12px] border border-[#E5E4E0] bg-white px-3 py-3 shadow-[0_14px_36px_rgba(15,15,15,0.13)]"
        style={{
          position: 'fixed',
          top: inspectorTop,
          left: inspectorLeft,
          width: INSPECTOR_WIDTH,
          zIndex: 1001
        }}
      >
        <div className="text-[14px] font-semibold text-[#252521]">{inspectedPreset.model.label}</div>
        {inspectedPreset.available ? (
          <>
            <p className="mt-1.5 text-[12px] leading-[18px] text-[#5F5E5A]">
              {inspectedPreset.model.description}
            </p>
            <div className="mt-2.5 border-t border-[#EEEEEC] pt-2.5 text-[12px]">
              <div className="flex items-center justify-between gap-3 py-0.5">
                <span className="shrink-0 text-[#9B9A97]">价格档位</span>
                <span className="font-medium text-[#37352F]">
                  {PRICE_TIER_LABELS[inspectedPreset.model.priceTier]}
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
              模型名：{inspectedPreset.model.id}
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
              {getProviderLogo(selectedPreset.provider.providerId)}
              <span className="truncate">{selectedPreset.modelLabel}</span>
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
