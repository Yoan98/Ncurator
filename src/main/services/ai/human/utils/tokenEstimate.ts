export const estimateTextTokens = (text: string): number => {
  const value = String(text || '')
  if (!value) return 0
  return Math.ceil(value.length / 4)
}

export const estimatePromptTokens = (input: { system: string; user: string }): number =>
  estimateTextTokens(`${input.system}\n${input.user}`)
