import { getAiRuntimePlatform } from '../../../utils/platform'

export type ShellCommandSegment = {
  text: string
  tokens: string[]
}

const readSegmentSeparator = (text: string, index: number): string | undefined => {
  const pair = text.slice(index, index + 2)
  if (pair === '&&' || pair === '||') return pair
  if (text[index] === ';' || text[index] === '|') return text[index]
  return undefined
}

const isWindowsPlatform = (): boolean => getAiRuntimePlatform() === 'windows'

export const parseShellTokens = (command: string, options?: { windowsStyle?: boolean }): string[] => {
  const text = String(command || '')
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false
  const windowsStyle = options?.windowsStyle ?? isWindowsPlatform()

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (!windowsStyle && char === '\\') {
      escaped = true
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (current) tokens.push(current)
      current = ''
      continue
    }

    current += char
  }

  if (current) tokens.push(current)
  return tokens
}

export const extractAbsolutePathTokens = (command: string): string[] =>
  parseShellTokens(command).filter(
    (token) => token.startsWith('/') || /^[a-z]:[\\/]/i.test(token) || /^\\\\/.test(token)
  )

export const parseShellCommandSegments = (
  command: string,
  options?: { windowsStyle?: boolean }
): ShellCommandSegment[] => {
  const text = String(command || '')
  const segments: ShellCommandSegment[] = []
  let quote: '"' | "'" | null = null
  let escaped = false
  let segmentStart = 0
  const windowsStyle = options?.windowsStyle ?? isWindowsPlatform()

  const pushSegment = (segmentText: string) => {
    const normalized = segmentText.trim()
    if (!normalized) return
    segments.push({
      text: normalized,
      tokens: parseShellTokens(normalized, { windowsStyle })
    })
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (escaped) {
      escaped = false
      continue
    }

    if (!windowsStyle && char === '\\') {
      escaped = true
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    const separator = readSegmentSeparator(text, index)
    if (!separator) continue

    pushSegment(text.slice(segmentStart, index))
    segmentStart = index + separator.length
    index += separator.length - 1
  }

  pushSegment(text.slice(segmentStart))
  return segments
}

export const splitCommandSegments = (command: string): string[] =>
  parseShellCommandSegments(command).map((segment) => segment.text)
