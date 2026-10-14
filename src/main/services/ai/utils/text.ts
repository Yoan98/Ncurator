export const clipText = (text: string, maxChars: number): string => {
  const raw = String(text || '')
  if (raw.length <= maxChars) return raw
  return raw.slice(0, maxChars)
}
