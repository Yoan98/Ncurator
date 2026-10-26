/** Error payloads and thrown values cross tool/runtime boundaries. */
export const readToolErrorMessage = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value.trim() || undefined
  if (!value || typeof value !== 'object') return undefined
  const error = 'error' in value ? value.error : undefined
  const message = 'message' in value ? value.message : undefined
  return (
    (typeof error === 'string' ? error.trim() : '') ||
    (typeof message === 'string' ? message.trim() : '') ||
    undefined
  )
}

export const resolveToolErrorMessage = (toolName: string, value?: unknown): string =>
  readToolErrorMessage(value) ||
  (toolName.trim() ? `Tool ${toolName} failed.` : 'Tool call failed.')

export const renderToolError = (toolName: string, value?: unknown): string => {
  const message = resolveToolErrorMessage(toolName, value)
  return /^Error:\s/u.test(message) ? message : `Error: ${message}`
}
