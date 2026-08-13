import type { AiRuntimePlatform } from '../../../../types'
import type { TerminalCommandSegment } from '../types'

const readSegmentSeparator = (text: string, index: number): string | undefined => {
  const pair = text.slice(index, index + 2)
  if (pair === '&&' || pair === '||') return pair
  const char = text[index]
  if (char === ';' || char === '|') return char
  if (char === '&') {
    const prev = text[index - 1]
    const next = text[index + 1]
    if (prev !== '>' && prev !== '<' && next !== '>') return char
  }
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
  let depth = 0
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

    if (char === '(' || char === '{') {
      depth += 1
      continue
    }
    if (char === ')' || char === '}') {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (depth > 0) continue

    const separator = readSegmentSeparator(text, index)
    if (!separator) continue

    pushSegment(text.slice(segmentStart, index))
    segmentStart = index + separator.length
    index += separator.length - 1
  }

  pushSegment(text.slice(segmentStart))
  return segments
}

const classifyRedirection = (
  text: string,
  index: number
): { kind: 'fd_merge' | 'file_redirect' | 'none'; length: number } => {
  const char = text[index]
  if (char === '>') {
    const next = text[index + 1]
    if (next === '>') {
      if (text[index + 2] === '&' && /[0-9]/.test(text[index + 3] || '')) {
        return { kind: 'fd_merge', length: 4 }
      }
      return { kind: 'file_redirect', length: 2 }
    }
    if (next === '&') {
      if (/[0-9]/.test(text[index + 2] || '')) return { kind: 'fd_merge', length: 3 }
      return { kind: 'file_redirect', length: 2 }
    }
    return { kind: 'file_redirect', length: 1 }
  }
  if (char === '&' && text[index + 1] === '>') {
    if (text[index + 2] === '>') {
      if (/[0-9]/.test(text[index + 3] || '')) return { kind: 'fd_merge', length: 4 }
      return { kind: 'file_redirect', length: 3 }
    }
    if (/[0-9]/.test(text[index + 2] || '')) return { kind: 'fd_merge', length: 3 }
    return { kind: 'file_redirect', length: 2 }
  }
  return { kind: 'none', length: 0 }
}

export const findUnsafeShellSyntax = (
  segmentText: string,
  platform: AiRuntimePlatform
): string | undefined => {
  let quote: '"' | "'" | null = null
  let escaped = false

  for (let index = 0; index < segmentText.length; index += 1) {
    const char = segmentText[index]

    if (escaped) {
      escaped = false
      continue
    }

    if (platform !== 'windows' && quote !== "'" && char === '\\') {
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

    if (char === '>' || char === '&') {
      const redirection = classifyRedirection(segmentText, index)
      if (redirection.kind === 'file_redirect') return 'redirection'
      if (redirection.kind === 'fd_merge') index += redirection.length - 1
    }
  }

  if (quote) return 'unclosed_quote'
  return undefined
}

export const extractEmbeddedShellPayloads = (
  segmentText: string,
  platform: AiRuntimePlatform
): string[] => {
  const text = String(segmentText || '')
  const payloads: string[] = []
  let quote: '"' | "'" | null = null
  let escaped = false

  const readBalanced = (
    start: number,
    open: '(' | '{',
    close: ')' | '}'
  ): { end: number; content: string } | null => {
    let depth = 1
    let innerQuote: '"' | "'" | null = null
    let innerEscaped = false
    for (let index = start; index < text.length; index += 1) {
      const char = text[index]
      if (innerEscaped) {
        innerEscaped = false
        continue
      }
      if (platform !== 'windows' && innerQuote !== "'" && char === '\\') {
        innerEscaped = true
        continue
      }
      if (innerQuote) {
        if (char === innerQuote) innerQuote = null
        continue
      }
      if (char === '"' || char === "'") {
        innerQuote = char
        continue
      }
      if (char === open) depth += 1
      else if (char === close) {
        depth -= 1
        if (depth === 0) return { end: index, content: text.slice(start, index) }
      }
    }
    return null
  }

  const readBacktick = (start: number): { end: number; content: string } | null => {
    let innerQuote: '"' | "'" | null = null
    let innerEscaped = false
    for (let index = start; index < text.length; index += 1) {
      const char = text[index]
      if (innerEscaped) {
        innerEscaped = false
        continue
      }
      if (innerQuote !== "'" && char === '\\') {
        innerEscaped = true
        continue
      }
      if (innerQuote) {
        if (char === innerQuote) innerQuote = null
        continue
      }
      if (char === '"' || char === "'") {
        innerQuote = char
        continue
      }
      if (char === '`') return { end: index, content: text.slice(start, index) }
    }
    return null
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (escaped) {
      escaped = false
      continue
    }

    if (platform !== 'windows' && char === '\\' && quote !== "'") {
      escaped = true
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
        continue
      }
      if (quote === '"') {
        if (char === '$' && text[index + 1] === '(') {
          const balanced = readBalanced(index + 2, '(', ')')
          if (balanced) {
            payloads.push(balanced.content)
            index = balanced.end
          }
          continue
        }
        if (platform !== 'windows' && char === '`') {
          const backtick = readBacktick(index + 1)
          if (backtick) {
            payloads.push(backtick.content)
            index = backtick.end
          }
          continue
        }
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (char === '$' && text[index + 1] === '(') {
      const balanced = readBalanced(index + 2, '(', ')')
      if (balanced) {
        payloads.push(balanced.content)
        index = balanced.end
      }
      continue
    }

    if (platform !== 'windows' && char === '`') {
      const backtick = readBacktick(index + 1)
      if (backtick) {
        payloads.push(backtick.content)
        index = backtick.end
      }
      continue
    }

    if (char === '(' || char === '{') {
      const balanced = readBalanced(index + 1, char, char === '(' ? ')' : '}')
      if (balanced) {
        payloads.push(balanced.content)
        index = balanced.end
      }
    }
  }

  return payloads
}
