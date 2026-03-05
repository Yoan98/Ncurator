const normalizeText = (value: string, fallback = '(none)') => {
  const text = String(value || '').trim()
  return text || fallback
}

const toLine = (input: { label: string; value: string }) => {
  return `${input.label}:\n${normalizeText(input.value)}`
}

export const renderPromptSections = (sections: Array<{ label: string; value: string }>) => {
  return sections.map((section) => toLine(section)).join('\n\n')
}

export const renderEvidenceLines = (lines: string[]) => {
  const joined = lines
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .join('\n')
  return normalizeText(joined)
}
