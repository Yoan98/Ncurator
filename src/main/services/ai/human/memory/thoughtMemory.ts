import type { HumanPlanItem, HumanRoundThought } from '../types'

export const normalizeThoughtText = (value: string): string =>
  String(value || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()

export const normalizePlanItems = (items: HumanPlanItem[]): HumanPlanItem[] =>
  items
    .map((item) => {
      const normalized: HumanPlanItem = {
        title: String(item.title || '').trim(),
        status: item.status
      }
      if (typeof item.evidence === 'string' && item.evidence.trim().length > 0) {
        normalized.evidence = normalizeThoughtText(item.evidence)
      }
      return normalized
    })
    .filter((item) => item.title.length > 0)

export const normalizeRoundThought = (text: string): HumanRoundThought => ({
  text: normalizeThoughtText(text)
})
