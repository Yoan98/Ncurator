type RenderLineStyle = 'plain' | 'bullet' | 'numbered'

const collectRenderLines = (values: Array<string | undefined>): string[] =>
  values.map((value) => String(value || '').trim()).filter(Boolean)

export const renderLineList = (
  values: Array<string | undefined>,
  input: {
    fallback: string
    style: RenderLineStyle
  }
): string => {
  const lines = collectRenderLines(values)
  if (lines.length === 0) return input.fallback

  if (input.style === 'plain') return lines.join('\n')
  if (input.style === 'bullet') return lines.map((line) => `- ${line}`).join('\n')
  return lines.map((line, index) => `${index + 1}. ${line}`).join('\n')
}
