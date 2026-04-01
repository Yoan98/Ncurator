import path from 'node:path'
import {
  createInitialAiRunState,
  type DirectorGraphState
} from '../../../src/main/services/ai/director/state/schema'
import type { HumanTaskOutput } from '../../../src/main/services/ai/types'
import type {
  AiFileArtifactCapability,
  AiFileArtifactOperation,
  AiFileArtifactRole,
  AiRunEvent,
  AiRunEventStage
} from '../../../src/shared/types'

export const filterDirectorEventsByType = <TType extends AiRunEvent['type']>(
  events: readonly AiRunEvent[],
  type: TType
): Extract<AiRunEvent, { type: TType }>[] =>
  events.filter(
    (event): event is Extract<AiRunEvent, { type: TType }> => event.type === type
  )

export const filterDirectorTaskEventsByStage = <
  TType extends Extract<AiRunEvent['type'], 'task_started' | 'task_completed'>
>(
  events: readonly AiRunEvent[],
  type: TType,
  stage: AiRunEventStage
): Extract<AiRunEvent, { type: TType }>[] =>
  filterDirectorEventsByType(events, type).filter((event) => event.stage === stage)

export const summarizeDirectorEvents = (events: readonly AiRunEvent[]): string[] =>
  events.flatMap((event) => {
    if (event.type === 'plan_created') {
      return [`plan_created:${event.plan.map((task) => task.id).join(',')}`]
    }
    if (event.type === 'task_started' || event.type === 'task_completed') {
      return [`${event.type}:${event.stage || 'unknown'}:${event.taskId}`]
    }
    return []
  })

export const createTestDirectorState = (
  input: Partial<DirectorGraphState> = {}
): DirectorGraphState =>
  ({
    ...createInitialAiRunState({
      runId: input.runId || 'director-test-run',
      sessionId: input.sessionId || 'director-test-session',
      input: input.input || '请处理当前 director 测试任务。'
    }),
    ...input
  }) as DirectorGraphState

export const applyDirectorPatch = (
  state: DirectorGraphState,
  patch: Partial<DirectorGraphState>
): DirectorGraphState =>
  ({
    ...state,
    ...patch
  }) as DirectorGraphState

export const createTestFileArtifact = (input: {
  path: string
  summary: string
  capability?: AiFileArtifactCapability
  operation?: AiFileArtifactOperation
  artifactRole?: AiFileArtifactRole
}): Extract<HumanTaskOutput['artifacts'][number], { kind: 'file' }> => ({
  kind: 'file',
  capability: input.capability || 'docx',
  path: input.path,
  fileName: path.basename(input.path),
  operation: input.operation || 'created',
  artifactRole: input.artifactRole,
  summary: input.summary
})
