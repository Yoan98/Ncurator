import type { HumanPlanItem } from '../types'

export const renderPlanItems = (items: HumanPlanItem[]): string =>
  items
    .map((item) => {
      const line = `- [${item.status}] ${item.title}`
      return item.evidence ? `${line}（依据：${item.evidence}）` : line
    })
    .join('\n')
