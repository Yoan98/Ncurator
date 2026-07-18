import type { AiRuntimePlatform } from '../../../../types'
import type { TerminalCommandSegment } from '../types'

const readSegmentSeparator = (text: string, index: number): string | undefined => {
  const pair = text.slice(index, index + 2)
  if (pair === '&&' || pair === '||') return pair
  if (text[index] === ';' || text[index] === '|') return text[index]
  return undefined
}

export const parseTerminalCommandTokens = (
  command: string,
  options?: { windowsStyle?: boolean }
): string[] => {
  const text = String(command || '')
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false
  const windowsStyle = options?.windowsStyle ?? false

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

export const parseTerminalCommandSegments = (
  command: string,
  options?: { windowsStyle?: boolean }
): TerminalCommandSegment[] => {
  const text = String(command || '')
  const segments: TerminalCommandSegment[] = []
  let quote: '"' | "'" | null = null
  let escaped = false
  let segmentStart = 0
  const windowsStyle = options?.windowsStyle ?? false

  const pushSegment = (segmentText: string) => {
    const normalized = segmentText.trim()
    if (!normalized) return
    segments.push({
      text: normalized,
      tokens: parseTerminalCommandTokens(normalized, { windowsStyle })
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
      if (char === quote) quote = null
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

export const findUnsafeShellSyntax = (
  segmentText: string,
  platform: AiRuntimePlatform
): string | undefined => {
  let quote: '"' | "'" | null = null
  let escaped = false

  for (let index = 0; index < segmentText.length; index += 1) {
    const char = segmentText[index]
    const next = segmentText[index + 1]

    if (escaped) {
      escaped = false
      continue
    }

    if (platform !== 'windows' && quote !== "'" && char === '\\') {
      escaped = true
      continue
    }

    if (platform === 'windows' && quote !== "'" && char === '`') {
      return 'powershell_escape_or_command_substitution'
    }

    if (quote) {
      if (quote === '"' && char === '$' && next === '(') return 'command_substitution'
      if (quote === '"' && platform !== 'windows' && char === '`') {
        return 'command_substitution'
      }
      if (char === quote) quote = null
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (char === '$' && next === '(') return 'command_substitution'
    if (char === '`') return 'command_substitution'
    if (char === '>' || char === '<') return 'redirection'
    if (char === '&') return 'background_or_invocation_operator'
    if (char === '(' || char === ')' || char === '{' || char === '}') {
      return 'dynamic_expression'
    }
  }

  if (quote) return 'unclosed_quote'
  return undefined
}
