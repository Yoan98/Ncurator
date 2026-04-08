import type { HumanState } from '../types'

const MAX_SUMMARY_LENGTH = 80

const clipSummary = (value: string): string => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= MAX_SUMMARY_LENGTH) return normalized
  return `${normalized.slice(0, MAX_SUMMARY_LENGTH - 1).trim()}…`
}

const stripMarkdownSyntax = (value: string): string =>
  value
    .replace(/`+/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/[*_~>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

export const deriveDeliverySummary = (input: {
  deliveryMarkdown: string
  state: HumanState
}): string => {
  const markdown = String(input.deliveryMarkdown || '').trim()
  if (markdown) {
    const headingLine = markdown
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => /^#{1,6}\s+\S+/.test(line))
    if (headingLine) {
      const summaryFromHeading = clipSummary(stripMarkdownSyntax(headingLine))
      if (summaryFromHeading) return summaryFromHeading
    }

    const paragraphs = markdown
      .split(/\n\s*\n/)
      .map((paragraph) => clipSummary(stripMarkdownSyntax(paragraph)))
      .filter(Boolean)
    if (paragraphs.length > 0) {
      return paragraphs[0]
    }
  }

  const decisionSummary = clipSummary(input.state.execution.currentDecision?.decision.summary || '')
  if (decisionSummary) return decisionSummary
  return '任务结束'
}
