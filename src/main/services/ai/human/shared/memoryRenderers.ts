import type { HumanPlanItemStatus } from '../types'

const PLAN_STATUS_LABELS: Record<HumanPlanItemStatus, string> = {
  todo: '[todo]',
  done: '[done]'
}

export const renderPlanItemStatus = (status: HumanPlanItemStatus): string =>
  PLAN_STATUS_LABELS[status]
