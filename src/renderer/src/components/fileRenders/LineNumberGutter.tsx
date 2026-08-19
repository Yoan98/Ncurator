import React, { useMemo } from 'react'

const GUTTER_TEXT_CLASS =
  'whitespace-pre px-3 py-6 text-right font-mono text-[13px] leading-6 tabular-nums text-[#B7B5AF]'

type LineNumberGutterProps = {
  lineCount: number
  className?: string
  innerRef?: React.Ref<HTMLDivElement>
  testId?: string
}

const LineNumberGutter: React.FC<LineNumberGutterProps> = ({
  lineCount,
  className,
  innerRef,
  testId
}) => {
  const numbers = useMemo(() => {
    let result = ''
    for (let i = 1; i <= lineCount; i += 1) {
      result += `${i}\n`
    }
    return result
  }, [lineCount])

  return (
    <div className={`shrink-0 select-none ${className || ''}`} aria-hidden="true" data-testid={testId}>
      <div ref={innerRef} className={GUTTER_TEXT_CLASS}>
        {numbers}
      </div>
    </div>
  )
}

export default LineNumberGutter
