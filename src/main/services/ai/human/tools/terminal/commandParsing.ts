const COMMAND_SEGMENT_SPLIT_PATTERN = /&&|\|\||;|\|/

export const parseShellTokens = (command: string): string[] => {
  const text = String(command || '')
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === '\\') {
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
  parseShellTokens(command).filter((token) => token.startsWith('/'))

export const splitCommandSegments = (command: string): string[] =>
  String(command || '')
    .split(COMMAND_SEGMENT_SPLIT_PATTERN)
    .map((segment) => segment.trim())
    .filter(Boolean)
