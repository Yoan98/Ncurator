import React, { useMemo } from 'react'
import { Select, Tooltip } from 'antd'
import { HiCpuChip } from 'react-icons/hi2'
import type { LLMConfig, LlmRemoteModel, WorkbenchModelSelection } from '../../../../shared/types'

type WorkbenchModelSelectorProps = {
  configs: LLMConfig[]
  modelListsByConfigId: Record<string, LlmRemoteModel[]>
  value: WorkbenchModelSelection
  onChange: (value: WorkbenchModelSelection) => void
  onAfterChange?: () => void
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
  disabled = false,
  noDrag = false,
  hideTriggerIcon = false,
  variant = 'composer',
  className,
  'data-testid': dataTestId
}) => {
  const options = useMemo(
    () =>
      configs.map((config) => ({
        label: config.name?.trim() || config.base_url,
        options: (modelListsByConfigId[config.id] || []).map((model) => ({
          label: model.label || model.id,
          value: `${config.id}\n${model.id}`
        }))
      })),
    [configs, modelListsByConfigId]
  )
  const selectedValue = value.mainModel
    ? `${value.mainModel.configId}\n${value.mainModel.modelName}`
    : undefined

  return (
    <Tooltip title={value.mainModel?.modelName || '请选择主模型'}>
      <div
        className={`${noDrag ? 'workbench-no-drag' : ''} ${className || ''}`.trim()}
        data-testid={dataTestId}
      >
        <Select
          showSearch
          optionFilterProp="label"
          disabled={disabled}
          value={selectedValue}
          options={options}
          placeholder="选择模型"
          notFoundContent="暂无匹配模型"
          suffixIcon={hideTriggerIcon ? null : <HiCpuChip className="h-4 w-4" />}
          popupMatchSelectWidth={variant === 'form' ? true : 320}
          className={variant === 'form' ? 'w-full' : 'min-w-[150px]'}
          onChange={(rawValue: string) => {
            const separator = rawValue.indexOf('\n')
            if (separator <= 0) return
            onChange({
              mainModel: {
                configId: rawValue.slice(0, separator),
                modelName: rawValue.slice(separator + 1)
              }
            })
            onAfterChange?.()
          }}
        />
      </div>
    </Tooltip>
  )
}

export default WorkbenchModelSelector
