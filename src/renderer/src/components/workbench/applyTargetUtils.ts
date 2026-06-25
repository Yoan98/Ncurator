import type { AiFileChangeRecord } from '../../../../shared/types'
import type { AssistantTurnApplyTarget } from './types'

export const buildApplyTarget = (record: AiFileChangeRecord): AssistantTurnApplyTarget => ({
  changeId: record.id,
  title: record.fileName,
  sourcePath: record.path,
  changeCount: record.changeCount,
  status: record.status
})

export const mergeApplyTargets = (
  current: AssistantTurnApplyTarget[],
  next: AssistantTurnApplyTarget
): AssistantTurnApplyTarget[] => [
  next,
  ...current.filter((item) => item.changeId !== next.changeId)
]

export const groupApplyTargetsByRunId = (
  records: AiFileChangeRecord[]
): Map<string, AssistantTurnApplyTarget[]> => {
  const grouped = new Map<string, AiFileChangeRecord[]>()
  records.forEach((record) => {
    const existing = grouped.get(record.runId) || []
    existing.push(record)
    grouped.set(record.runId, existing)
  })

  return new Map(
    [...grouped.entries()].map(([runId, runRecords]) => [
      runId,
      Array.from(
        runRecords
          .slice()
          .sort((left, right) => right.updatedAt - left.updatedAt)
          .reduce((latestByPath, record) => {
            const key = record.path || record.id
            if (!latestByPath.has(key)) latestByPath.set(key, record)
            return latestByPath
          }, new Map<string, AiFileChangeRecord>())
          .values()
      )
        .slice()
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .map((record) => buildApplyTarget(record))
    ])
  )
}
