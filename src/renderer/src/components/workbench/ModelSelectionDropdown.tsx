/* eslint-disable react-refresh/only-export-components */
import React, { useMemo } from 'react'
import { Tooltip } from 'antd'
import { HiAdjustmentsHorizontal, HiArrowLeft } from 'react-icons/hi2'
import { PiEyesFill } from 'react-icons/pi'
import type { LLMConfig, LlmRemoteModel } from '../../../../shared/types'
import { resolveLlmProvider } from '../../../../shared/llmProvider'
import {
  LLM_PRESET_PROVIDERS,
  LLM_PRICE_TIER_LABELS,
  type LlmPresetModel,
  type LlmPresetProvider
} from '../../../../shared/llmPresets'
import { getProviderLogo } from '../settings/constants'
import { PriceTierBadge } from '../PriceTierBadge'

export const CUSTOM_MODEL_ENTRY_VALUE = '__custom_model__'
export const BACK_TO_PRESET_VALUE = '__back_to_preset__'
const REFRESH_MODELS_VALUE = '__refresh_models__'

type ModelSelectEntry = {
  value?: string
  searchText?: string
  label: React.ReactNode
  disabled?: boolean
  options?: ModelSelectEntry[]
}

export type ModelSelectionView = 'preset' | 'all'

const toOptionValue = (configId: string, modelName: string): string =>
  `${configId}\n${modelName}`

const splitOptionValue = (rawValue: string): { configId: string; modelName: string } | null => {
  const separator = rawValue.indexOf('\n')
  if (separator <= 0) return null
  return {
    configId: rawValue.slice(0, separator),
    modelName: rawValue.slice(separator + 1)
  }
}

const PresetModelOption: React.FC<{
  provider: LlmPresetProvider
  model: LlmPresetModel
  disabled: boolean
}> = ({ provider, model, disabled }) => {
  const coin = <PriceTierBadge tier={model.priceTier} />
  const eye = <PiEyesFill className="h-3 w-3" />
  const content = (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {getProviderLogo(provider.providerId)}
      <span className="min-w-0 truncate">{model.label}</span>
      {disabled ? (
        <span className="inline-flex">{coin}</span>
      ) : (
        <Tooltip title={`价格：${LLM_PRICE_TIER_LABELS[model.priceTier]}`}>
          <span className="inline-flex">{coin}</span>
        </Tooltip>
      )}
      {model.vision ? (
        disabled ? (
          <span className="inline-flex text-[#787774]">{eye}</span>
        ) : (
          <Tooltip title="支持图片理解">
            <span className="inline-flex text-[#787774]">{eye}</span>
          </Tooltip>
        )
      ) : null}
    </span>
  )
  if (disabled) {
    return (
      <Tooltip title={`未配置 ${provider.label}`}>
        <span className="inline-block max-w-full opacity-50">{content}</span>
      </Tooltip>
    )
  }
  return content
}

export const useModelSelectionOptions = (input: {
  configs: LLMConfig[]
  modelListsByConfigId: Record<string, LlmRemoteModel[]>
  viewMode: ModelSelectionView
  selectedKey?: string
  selectedModelName?: string
}): {
  options: ModelSelectEntry[]
  handleSelect: (rawValue: string) => 'select' | 'switch-view' | 'refresh' | null
} => {
  const { configs, modelListsByConfigId, viewMode, selectedKey, selectedModelName } = input

  const presetOptions = useMemo((): ModelSelectEntry[] =>
    LLM_PRESET_PROVIDERS.flatMap((provider) => {
        const matchedConfig = configs.find(
          (config) => resolveLlmProvider(config.base_url).providerId === provider.providerId
        )
        return provider.models.map((model) => ({
          value: matchedConfig ? toOptionValue(matchedConfig.id, model.id) : model.id,
          searchText: `${provider.label} ${model.label} ${model.id}`,
          disabled: !matchedConfig,
          label: (
            <PresetModelOption
              provider={provider}
              model={model}
              disabled={!matchedConfig}
            />
          )
        }))
      }),
    [configs]
  )

  const customModelEntryOption = useMemo<ModelSelectEntry>(
    () => ({
      value: CUSTOM_MODEL_ENTRY_VALUE,
      searchText: '自定义模型',
      label: (
        <span className="inline-flex items-center gap-1.5 text-[#787774]">
          <HiAdjustmentsHorizontal className="h-3.5 w-3.5" />
          自定义模型
        </span>
      )
    }),
    []
  )

  const hasAnyRemoteModels = useMemo(
    () => configs.some((config) => (modelListsByConfigId[config.id] || []).length > 0),
    [configs, modelListsByConfigId]
  )

  const allOptions = useMemo((): ModelSelectEntry[] => {
    const body: ModelSelectEntry[] = []
    if (hasAnyRemoteModels) {
      for (const config of configs) {
        const models = modelListsByConfigId[config.id] || []
        if (models.length === 0) continue
        body.push({
          label: config.name?.trim() || config.base_url,
          options: models.map((model) => ({
            label: model.label || model.id,
            searchText: `${config.name?.trim() || ''} ${model.label || ''} ${model.id}`,
            value: toOptionValue(config.id, model.id)
          }))
        })
      }
    } else if (configs.length > 0) {
      body.push({
        value: REFRESH_MODELS_VALUE,
        searchText: '重新获取模型列表',
        label: (
          <span className="inline-flex items-center gap-1.5 text-[#787774]">
            <HiAdjustmentsHorizontal className="h-3.5 w-3.5" />
            模型列表获取失败，重新获取
          </span>
        )
      })
    }
    return [
      {
        value: BACK_TO_PRESET_VALUE,
        searchText: '返回推荐模型',
        label: (
          <span className="inline-flex items-center gap-1.5 text-[#787774]">
            <HiArrowLeft className="h-3.5 w-3.5" />
            返回推荐模型
          </span>
        )
      },
      ...body
    ]
  }, [configs, modelListsByConfigId, hasAnyRemoteModels])

  const options = useMemo(() => {
    const base = viewMode === 'preset' ? [...presetOptions, customModelEntryOption] : allOptions
    if (!selectedKey) return base
    const exists = base.some((entry) => {
      if (Array.isArray(entry.options)) {
        return entry.options.some((option) => option.value === selectedKey)
      }
      return entry.value === selectedKey
    })
    if (exists) return base
    return [
      {
        label: selectedModelName || '',
        searchText: selectedModelName || '',
        value: selectedKey,
        disabled: true
      },
      ...base
    ]
  }, [viewMode, presetOptions, customModelEntryOption, allOptions, selectedKey, selectedModelName])

  const handleSelect = (rawValue: string): 'select' | 'switch-view' | 'refresh' | null => {
    if (rawValue === CUSTOM_MODEL_ENTRY_VALUE || rawValue === BACK_TO_PRESET_VALUE) {
      return 'switch-view'
    }
    if (rawValue === REFRESH_MODELS_VALUE) {
      return 'refresh'
    }
    return splitOptionValue(rawValue) ? 'select' : null
  }

  return { options, handleSelect }
}