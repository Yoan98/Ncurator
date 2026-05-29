import type { DocxApplyRecord } from '../../../../shared/types'
import type { AssistantTurnApplyTarget } from './types'

export const buildApplyTarget = (record: DocxApplyRecord): AssistantTurnApplyTarget => ({
  applyId: record.id,
  title: record.source_name,
  changeCount: record.change_count,
  status: record.status
})

export const mergeApplyTargets = (
  current: AssistantTurnApplyTarget[],
  next: AssistantTurnApplyTarget
): AssistantTurnApplyTarget[] => [
  next,
  ...current.filter((item) => item.applyId !== next.applyId)
]

export const groupApplyTargetsByRunId = (
  records: DocxApplyRecord[]
): Map<string, AssistantTurnApplyTarget[]> => {
  const grouped = new Map<string, DocxApplyRecord[]>()
  records.forEach((record) => {
    const existing = grouped.get(record.run_id) || []
    existing.push(record)
    grouped.set(record.run_id, existing)
  })

  return new Map(
    [...grouped.entries()].map(([runId, runRecords]) => [
      runId,
      runRecords
        .slice()
        .sort((left, right) => right.updated_at - left.updated_at)
        .map((record) => buildApplyTarget(record))
    ])
  )
}
