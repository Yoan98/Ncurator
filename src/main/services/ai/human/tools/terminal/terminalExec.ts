export type TerminalOutputQualityReport = {
  unusable: boolean
  totalChars: number
  replacementCharCount: number
  replacementCharRatio: number
  controlCharCount: number
  controlCharRatio: number
}

const MIN_RATIO_CHECK_CHARS = 100
const UNUSABLE_RATIO_THRESHOLD = 0.15

const countMatches = (value: string, pattern: RegExp): number =>
  Array.from(value.matchAll(pattern)).length

const countC0ControlChars = (value: string): number => {
  let count = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) count += 1
  }
  return count
}

const roundRatio = (value: number): number => Number(value.toFixed(4))

const formatPercent = (ratio: number): string => `${Math.round(ratio * 100)}%`

const findFirstControlChar = (value: string): string | undefined => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`
    }
  }
  return undefined
}

/** Build a short factual error for the model when output fails the ratio check. */
export const formatTerminalUnusableError = (input: {
  report: TerminalOutputQualityReport
  output: string
}): string => {
  const { report, output } = input
  const samples: string[] = []
  if (report.replacementCharCount > 0) samples.push('�')
  if (report.controlCharCount > 0) {
    const control = findFirstControlChar(output)
    if (control) samples.push(control)
  }
  const sampleSuffix = samples.length > 0 ? `；样例：${samples.join('、')}` : ''
  return (
    `终端输出含过多不可读字符：替换符 ${report.replacementCharCount}/${report.totalChars}` +
    `（${formatPercent(report.replacementCharRatio)}），` +
    `控制字符 ${report.controlCharCount}/${report.totalChars}` +
    `（${formatPercent(report.controlCharRatio)}）` +
    `${sampleSuffix}。`
  )
}

export const TERMINAL_UNUSABLE_OUTPUT_PLACEHOLDER =
  '[terminal output omitted: unreadable character ratio exceeded]'

export const inspectTerminalOutputQuality = (
  stdout: string,
  stderr: string
): TerminalOutputQualityReport => {
  const output = `${stdout || ''}${stderr || ''}`
  const totalChars = output.length
  const replacementCharCount = countMatches(output, /\uFFFD/g)
  const controlCharCount = countC0ControlChars(output)
  const replacementCharRatio = totalChars > 0 ? replacementCharCount / totalChars : 0
  const controlCharRatio = totalChars > 0 ? controlCharCount / totalChars : 0
  const ratioEligible = totalChars >= MIN_RATIO_CHECK_CHARS
  const unusable =
    ratioEligible &&
    (replacementCharRatio >= UNUSABLE_RATIO_THRESHOLD ||
      controlCharRatio >= UNUSABLE_RATIO_THRESHOLD)

  return {
    unusable,
    totalChars,
    replacementCharCount,
    replacementCharRatio: roundRatio(replacementCharRatio),
    controlCharCount,
    controlCharRatio: roundRatio(controlCharRatio)
  }
}
