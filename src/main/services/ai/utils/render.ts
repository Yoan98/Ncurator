type RenderLineStyle = 'plain' | 'bullet' | 'numbered'

export const normalizeRenderText = (value: string | undefined, fallback: string): string => {
  const text = String(value || '').trim()
  return text || fallback
}

export const collectRenderLines = (values: Array<string | undefined>): string[] =>
  values.map((value) => String(value || '').trim()).filter(Boolean)

export const renderInlineList = (
  values: Array<string | undefined>,
  input: {
    fallback: string
    separator?: string
  }
): string => {
  const items = collectRenderLines(values)
  if (items.length === 0) return input.fallback

  return items.join(input.separator || '、')
}

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

export const renderNamedSections = (
  sections: Array<{ label: string; value: string }>,
  input: {
    fallback: string
    style: 'plain' | 'markdown'
    headingLevel?: string
  }
): string =>
  sections
    .map((section) => {
      const body = normalizeRenderText(section.value, input.fallback)
      if (input.style === 'markdown') {
        return `${input.headingLevel || '##'} ${section.label}\n${body}`
      }
      return `${section.label}:\n${body}`
    })
    .join('\n\n')
