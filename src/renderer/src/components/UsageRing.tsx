import type { ReactNode } from 'react'
import { Tooltip } from 'antd'

const circumference = 2 * Math.PI * 6.5

export default function UsageRing({
  ratio,
  label,
  tooltip,
  testId
}: {
  ratio: number | null
  label: string
  tooltip: ReactNode
  testId?: string
}) {
  const percent = Math.max(0, (ratio ?? 0) * 100)
  const visiblePercent = Math.min(100, Math.max(percent > 0 ? 1 : 0, Math.round(percent)))
  const stroke = percent >= 90 ? '#B3261E' : percent >= 70 ? '#B26A00' : '#787774'
  return (
    <Tooltip title={tooltip} trigger={['hover', 'focus']}>
      <button
        type="button"
        className="nc-usage-ring relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-0 p-0"
        aria-label={label}
        data-testid={testId}
      >
        <svg className="h-4 w-4 -rotate-90" viewBox="0 0 16 16" aria-hidden="true">
          <circle
            className="nc-usage-ring-track"
            cx="8"
            cy="8"
            r="6.5"
            fill="none"
            stroke="#E8E7E4"
            strokeWidth="1.5"
          />
          <circle
            className="nc-usage-ring-progress"
            cx="8"
            cy="8"
            r="6.5"
            fill="none"
            stroke={stroke}
            strokeWidth="1.5"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - visiblePercent / 100)}
            strokeLinecap="round"
          />
        </svg>
      </button>
    </Tooltip>
  )
}
