import { useRef, useState, type ReactNode } from 'react'
import { Input, Popover, Tooltip } from 'antd'
import { PiCaretDown } from 'react-icons/pi'
import { t } from '../../i18n'

// These are document colors; they keep their actual values in both application themes.
const colors = [
  '#000000',
  '#595959',
  '#B3261E',
  '#0B6BCB',
  '#2F6F4E',
  '#8065A5',
  '#FFFF00',
  '#00FF00',
  '#00FFFF',
  '#FF00FF',
  '#FF0000',
  '#0000FF',
  '#FFF2A8',
  '#CCE8CE',
  '#C9E4FA',
  '#E6D4F1',
  '#F5D0D0',
  '#FFFFFF'
]

export default function DocxColorPicker({
  label,
  icon,
  value,
  initialColor,
  disabled,
  capture,
  apply
}: {
  label: string
  icon: ReactNode
  value?: string
  initialColor: string
  disabled: boolean
  capture: () => void
  apply: (color: string | null) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [lastColor, setLastColor] = useState(initialColor)
  const [custom, setCustom] = useState(initialColor)
  const [showCustom, setShowCustom] = useState(false)
  const arrow = useRef<HTMLButtonElement>(null)
  const choose = async (color: string | null) => {
    const unchanged = color !== null && value?.toUpperCase() === color.toUpperCase()
    if (!unchanged && !(await apply(color))) return
    if (color) setLastColor(color)
    setOpen(false)
  }
  const valid = /^#[\da-f]{6}$/i.test(custom)
  return (
    <span
      className="nc-docx-color-split"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
        arrow.current?.focus()
      }}
    >
      <Tooltip title={`${label} ${lastColor}`}>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void choose(lastColor)}
          className="nc-docx-color-apply"
        >
          {icon}
          <span className="nc-docx-color-indicator" style={{ background: lastColor }} />
        </button>
      </Tooltip>
      <Popover
        trigger="click"
        placement="bottomLeft"
        open={open && !disabled}
        onOpenChange={(next) => {
          if (next) {
            capture()
            setShowCustom(false)
            setCustom(value || lastColor)
          }
          setOpen(next)
        }}
        content={
          <div
            className="nc-docx-color-panel"
            role="dialog"
            aria-label={label}
            onMouseDown={(event) => {
              if (event.target instanceof Element && event.target.closest('button'))
                event.preventDefault()
            }}
          >
            <div className="nc-docx-color-title">{label}</div>
            <div className="nc-docx-color-grid">
              {colors.map((color) => (
                <Tooltip title={color} key={color}>
                  <button
                    type="button"
                    aria-label={color}
                    aria-pressed={value?.toUpperCase() === color}
                    disabled={disabled}
                    style={{ background: color }}
                    onClick={() => void choose(color)}
                  />
                </Tooltip>
              ))}
            </div>
            <button type="button" disabled={disabled} onClick={() => void choose(null)}>
              {t(($) => $.editors.wordRibbon.noColor)}
            </button>
            <button type="button" onClick={() => setShowCustom((next) => !next)}>
              {t(($) => $.editors.wordRibbon.customColor)}
            </button>
            {showCustom && (
              <div className="nc-docx-custom-color">
                <input
                  type="color"
                  aria-label={t(($) => $.editors.wordRibbon.colorPicker)}
                  value={valid ? custom : lastColor}
                  onChange={(e) => setCustom(e.target.value)}
                />
                <Input
                  size="small"
                  aria-label={t(($) => $.editors.wordRibbon.colorHex)}
                  value={custom}
                  status={valid ? undefined : 'error'}
                  onChange={(e) => setCustom(e.target.value)}
                  onPressEnter={() => {
                    if (valid) void choose(custom)
                  }}
                />
                <button
                  type="button"
                  disabled={!valid || disabled}
                  onClick={() => void choose(custom)}
                >
                  {t(($) => $.editors.apply)}
                </button>
              </div>
            )}
          </div>
        }
      >
        <button
          ref={arrow}
          type="button"
          className="nc-docx-color-arrow"
          aria-label={t(($) => $.editors.wordRibbon.chooseColor, { value1: label })}
          aria-expanded={open}
          disabled={disabled}
          onMouseDown={(event) => {
            event.preventDefault()
            capture()
          }}
        >
          <PiCaretDown />
        </button>
      </Popover>
    </span>
  )
}
