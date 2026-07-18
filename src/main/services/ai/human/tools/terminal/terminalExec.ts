export type TerminalUnusableOutputSignature =
  | 'NUL'
  | 'PK_HEADER'
  | 'PDF_HEADER'
  | 'OFFICE_WORD_XML'
  | 'OFFICE_EXCEL_XML'
  | 'OFFICE_POWERPOINT_XML'
  | 'REPLACEMENT_CHAR_RATIO'
  | 'CONTROL_CHAR_RATIO'

export type TerminalOutputQualityReport = {
  unusable: boolean
  totalChars: number
  nulCount: number
  replacementCharCount: number
  replacementCharRatio: number
  controlCharCount: number
  controlCharRatio: number
  matchedSignatures: TerminalUnusableOutputSignature[]
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

export const inspectTerminalOutputQuality = (
  stdout: string,
  stderr: string
): TerminalOutputQualityReport => {
  const output = `${stdout || ''}${stderr || ''}`
  const totalChars = output.length
  const nulCount = output.split('\u0000').length - 1
  const replacementCharCount = countMatches(output, /\uFFFD/g)
  const controlCharCount = countC0ControlChars(output)
  const replacementCharRatio = totalChars > 0 ? replacementCharCount / totalChars : 0
  const controlCharRatio = totalChars > 0 ? controlCharCount / totalChars : 0
  const matchedSignatures: TerminalUnusableOutputSignature[] = []

  if (nulCount > 0) matchedSignatures.push('NUL')
  if (output.includes('PK\u0003\u0004')) matchedSignatures.push('PK_HEADER')
  if (output.includes('%PDF-')) matchedSignatures.push('PDF_HEADER')
  if (output.includes('word/document.xml')) matchedSignatures.push('OFFICE_WORD_XML')
  if (output.includes('xl/workbook.xml')) matchedSignatures.push('OFFICE_EXCEL_XML')
  if (output.includes('ppt/presentation.xml')) matchedSignatures.push('OFFICE_POWERPOINT_XML')
  if (totalChars >= MIN_RATIO_CHECK_CHARS && replacementCharRatio >= UNUSABLE_RATIO_THRESHOLD) {
    matchedSignatures.push('REPLACEMENT_CHAR_RATIO')
  }
  if (totalChars >= MIN_RATIO_CHECK_CHARS && controlCharRatio >= UNUSABLE_RATIO_THRESHOLD) {
    matchedSignatures.push('CONTROL_CHAR_RATIO')
  }

  return {
    unusable: matchedSignatures.length > 0,
    totalChars,
    nulCount,
    replacementCharCount,
    replacementCharRatio: roundRatio(replacementCharRatio),
    controlCharCount,
    controlCharRatio: roundRatio(controlCharRatio),
    matchedSignatures
  }
}

export const buildWindowsPowerShellEncodedCommand = (command: string): string => {
  const wrappedCommand = [
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '$OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    command
  ].join('\n')
  return Buffer.from(wrappedCommand, 'utf16le').toString('base64')
}
