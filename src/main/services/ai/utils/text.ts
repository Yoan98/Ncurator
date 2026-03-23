export const clipText = (text: string, maxChars: number): string => {
  const raw = String(text || '')
  if (raw.length <= maxChars) return raw
  return raw.slice(0, maxChars)
}

export const clipTextWithMeta = (
  text: string,
  maxChars: number
): { text: string; truncated: boolean } => {
  const raw = String(text || '')
  if (raw.length <= maxChars) {
    return {
      text: raw,
      truncated: false
    }
  }

  return {
    text: raw.slice(0, maxChars),
    truncated: true
  }
}
