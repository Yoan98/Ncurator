import type { ReactNode } from 'react'
import { Tooltip } from 'antd'

export type SettingsChoiceOption<T extends string> = {
  value: T
  /** 屏幕阅读器与悬浮提示用的完整名称。 */
  label: string
  /** 卡片里的缩略图或字符标记。 */
  preview: ReactNode
}

/**
 * 分段卡片选择器：用于选项少、结果又能直接画出来的设置（主题、语言）。
 * 卡片本身就是预览，所以缩略图色值固定、不跟随主题切换。
 */
export default function SettingsChoiceCards<T extends string>({
  label,
  value,
  options,
  disabled,
  testIdPrefix,
  onChange
}: {
  label: string
  value: T
  options: SettingsChoiceOption<T>[]
  disabled?: boolean
  testIdPrefix: string
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <div
      className="nc-choice-cards"
      role="radiogroup"
      aria-label={label}
      data-testid={`${testIdPrefix}-group`}
    >
      {options.map((option) => {
        const checked = option.value === value
        return (
          <Tooltip key={option.value} title={option.label} placement="top" mouseEnterDelay={0.25}>
            <button
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={option.label}
              disabled={disabled}
              data-testid={`${testIdPrefix}-${option.value}`}
              data-checked={checked ? 'true' : undefined}
              className="nc-choice-card"
              onClick={() => {
                if (!checked) onChange(option.value)
              }}
            >
              <span className="nc-choice-card-preview" aria-hidden="true">
                {option.preview}
              </span>
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}
