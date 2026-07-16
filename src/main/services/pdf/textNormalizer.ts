type PdfTextItemLike = {
  str: string
  transform: number[]
  width: number
  height: number
  hasEOL?: boolean
}

const CJK_CHAR_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
// JavaScript 没有等价的 Unicode 属性可一次表达这组 PDF 控制字符。
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu
const PRIVATE_USE_PATTERN = /[\uE000-\uF8FF]/gu

const isCjkBoundary = (left: string, right: string): boolean =>
  CJK_CHAR_PATTERN.test(left.slice(-1)) && CJK_CHAR_PATTERN.test(right.slice(0, 1))

const shouldInsertSpace = (input: {
  previousText: string
  nextText: string
  previousEndX?: number
  nextX: number
  fontSize: number
}): boolean => {
  if (!input.previousText || !input.nextText) return false
  if (/\s$/u.test(input.previousText) || /^\s/u.test(input.nextText)) return false
  if (isCjkBoundary(input.previousText, input.nextText)) return false
  if (/^[,.;:!?，。；：！？、)\]}]/u.test(input.nextText)) return false
  if (/[([{（【《“‘]$/u.test(input.previousText)) return false
  if (typeof input.previousEndX !== 'number') return true
  return input.nextX - input.previousEndX > Math.max(1, input.fontSize * 0.18)
}

export const normalizePdfText = (value: string): string => {
  const normalized = value
    .normalize('NFKC')
    .replace(/\r/gu, '')
    .replace(CONTROL_CHAR_PATTERN, '')
    .replace(/\u00a0/gu, ' ')

  return normalized
    .split('\n')
    .map((line) => line.trim().replace(/[\t ]+/gu, ' '))
    .filter(Boolean)
    .join('\n')
    .replace(
      /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]) +(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])/gu,
      '$1'
    )
}

export const buildPdfPageText = (
  rawItems: readonly unknown[]
): { text: string; suspicious: boolean; warnings: string[] } => {
  const items = rawItems.filter((item): item is PdfTextItemLike =>
    Boolean(
      item &&
      typeof item === 'object' &&
      'str' in item &&
      typeof (item as { str?: unknown }).str === 'string' &&
      'transform' in item &&
      Array.isArray((item as { transform?: unknown }).transform)
    )
  )
  const rawJoined = items.map((item) => item.str).join('')
  const replacementCount = (rawJoined.match(/\uFFFD/gu) || []).length
  const privateUseCount = (rawJoined.match(PRIVATE_USE_PATTERN) || []).length
  const controlCount = (rawJoined.match(CONTROL_CHAR_PATTERN) || []).length
  const suspiciousCount = replacementCount + privateUseCount + controlCount
  const suspicious = rawJoined.length > 0 && suspiciousCount / rawJoined.length > 0.01

  const lines: string[] = []
  let line = ''
  let currentY: number | undefined
  let previousEndX: number | undefined
  let previousFontSize = 10

  const flush = () => {
    const normalizedLine = normalizePdfText(line)
    if (normalizedLine) lines.push(normalizedLine)
    line = ''
    currentY = undefined
    previousEndX = undefined
  }

  for (const item of items) {
    const text = item.str
    if (!text) {
      if (item.hasEOL) flush()
      continue
    }
    const x = Number(item.transform[4] || 0)
    const y = Number(item.transform[5] || 0)
    const fontSize = Math.max(1, Math.abs(Number(item.transform[3] || item.height || 10)))
    const isNewLine =
      typeof currentY === 'number' && Math.abs(y - currentY) > Math.max(2, previousFontSize * 0.55)
    if (isNewLine) flush()
    if (
      shouldInsertSpace({
        previousText: line,
        nextText: text,
        previousEndX,
        nextX: x,
        fontSize
      })
    ) {
      line += ' '
    }
    line += text
    currentY = y
    previousFontSize = fontSize
    previousEndX = x + Math.max(0, Number(item.width || 0))
    if (item.hasEOL) flush()
  }
  flush()

  const warnings: string[] = []
  if (replacementCount > 0) warnings.push(`检测到 ${String(replacementCount)} 个替换字符`)
  if (privateUseCount > 0) warnings.push(`检测到 ${String(privateUseCount)} 个私用区字符`)
  if (controlCount > 0) warnings.push(`已清理 ${String(controlCount)} 个控制字符`)
  return {
    text: normalizePdfText(lines.join('\n')),
    suspicious,
    warnings
  }
}
