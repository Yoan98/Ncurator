import type { HumanPlanItem, HumanPlanItemStatus } from '../types'

const PLAN_STATUS_LABELS: Record<HumanPlanItemStatus, string> = {
  todo: '[todo]',
  done: '[done]'
}

export const renderPlanItemStatus = (status: HumanPlanItemStatus): string =>
  PLAN_STATUS_LABELS[status]

export const renderPlanItems = (items: HumanPlanItem[]): string =>
  items.map((item) => `- ${renderPlanItemStatus(item.status)} ${item.title}`).join('\n')
