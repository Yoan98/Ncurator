import type { HumanPlanItem, HumanRoundThought } from '../types'
import { normalizeThoughtText } from '../../../../../shared/thoughtText'

export const normalizePlanItems = (items: HumanPlanItem[]): HumanPlanItem[] =>
  items
    .map((item) => ({
      title: String(item.title || '').trim(),
      status: item.status
    }))
    .filter((item) => item.title.length > 0)

export const normalizeRoundThought = (text: string): HumanRoundThought => ({
  text: normalizeThoughtText(text)
})
