export const estimateTextTokens = (text: string): number => {
  const value = String(text || '')
  if (!value) return 0
  return Math.ceil(value.length / 4)
}
