import React, { useMemo } from 'react'
import { buildLineNumbers } from './lineNumbers'

const NUMBER_TEXT_CLASS =
  'whitespace-pre pt-6 pr-1.5 text-right font-mono text-[13px] leading-6 tabular-nums text-[#B7B5AF]'

type LineNumberOverlayProps = {
  lineCount: number
  className?: string
  innerRef?: React.Ref<HTMLDivElement>
  testId?: string
}

const LineNumberOverlay: React.FC<LineNumberOverlayProps> = ({
  lineCount,
  className,
  innerRef,
  testId
}) => {
  const numbers = useMemo(() => buildLineNumbers(lineCount), [lineCount])

  return (
    <div
      className={`pointer-events-none absolute left-0 top-0 select-none ${className || ''}`}
      aria-hidden="true"
      data-testid={testId}
    >
      <div ref={innerRef} className={NUMBER_TEXT_CLASS}>
        {numbers}
      </div>
    </div>
  )
}

export default LineNumberOverlay
