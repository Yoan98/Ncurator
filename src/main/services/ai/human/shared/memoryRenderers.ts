import type { HumanPlanItem } from '../types'

export const renderPlanItems = (items: HumanPlanItem[]): string =>
  items.map((item) => `- [${item.status}] ${item.title}`).join('\n')
