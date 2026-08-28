import React, { useMemo, useState } from 'react'
import { Select, Tooltip } from 'antd'
import { HiCpuChip } from 'react-icons/hi2'
import type {
  LLMConfig,
  LlmRemoteModel,
  WorkbenchModelSelection
} from '../../../../shared/types'
import { LLM_PRESET_PROVIDERS, resolvePresetModeProvider } from '../../../../shared/llmPresets'
import { getProviderLogo } from '../settings/constants'
import {
  useModelSelectionOptions,
  type ModelSelectionView
} from './ModelSelectionDropdown'

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
  const [viewMode, setViewMode] = useState<ModelSelectionView>('preset')

  const selectedKey = value.mainModel
    ? `${value.mainModel.configId}\n${value.mainModel.modelName}`
    : undefined

  const { options, handleSelect } = useModelSelectionOptions({
    configs,
    modelListsByConfigId,
    viewMode,
    selectedKey,
    selectedModelName: value.mainModel?.modelName
  })

  const selectedDisplay = useMemo(() => {
    if (!value.mainModel) return undefined
    const { configId, modelName } = value.mainModel
    const config = configs.find((item) => item.id === configId)
    const preset = config ? resolvePresetModeProvider(config) : null
    if (preset) {
      const model = LLM_PRESET_PROVIDERS.find(
        (provider) => provider.providerId === preset.providerId
      )?.models.find((item) => item.id === modelName)
      return (
        <span className="inline-flex items-center gap-1.5">
          {getProviderLogo(preset.providerId)}
          <span className="truncate">{model?.label || modelName}</span>
        </span>
      )
    }
    const remoteModel = config
      ? (modelListsByConfigId[config.id] || []).find((item) => item.id === modelName)
      : undefined
    return <span>{remoteModel?.label || modelName}</span>
  }, [value.mainModel, configs, modelListsByConfigId])

  const handleChange = (rawValue: string): void => {
    const action = handleSelect(rawValue)
    if (action === 'switch-view') {
      setViewMode((current) => (current === 'preset' ? 'all' : 'preset'))
      return
    }
    if (action === 'refresh') {
      void onRefreshModelLists?.()
      return
    }
    if (action !== 'select') return
    const separator = rawValue.indexOf('\n')
    if (separator <= 0) return
    onChange({
      mainModel: {
        configId: rawValue.slice(0, separator),
        modelName: rawValue.slice(separator + 1)
      }
    })
    onAfterChange?.()
  }

  return (
    <Tooltip title={value.mainModel?.modelName || '请选择主模型'}>
      <div
        className={`${noDrag ? 'workbench-no-drag' : ''} ${className || ''}`.trim()}
        data-testid={dataTestId}
      >
        <Select
          showSearch
          filterOption={(inputValue, option) => {
            const searchText = String(
              (option as { searchText?: unknown } | undefined)?.searchText || ''
            )
            return searchText.toLowerCase().includes(inputValue.toLowerCase())
          }}
          disabled={disabled}
          value={selectedKey}
          options={options}
          labelRender={() => selectedDisplay}
          placeholder="选择模型"
          notFoundContent="暂无匹配模型"
          suffixIcon={hideTriggerIcon ? null : <HiCpuChip className="h-4 w-4" />}
          popupMatchSelectWidth={variant === 'form' ? true : 320}
          className={variant === 'form' ? 'w-full' : 'min-w-[150px]'}
          onChange={handleChange}
          onDropdownVisibleChange={(open) => {
            if (open && viewMode === 'all' && configs.length === 0) setViewMode('preset')
          }}
        />
      </div>
    </Tooltip>
  )
}

export default WorkbenchModelSelector