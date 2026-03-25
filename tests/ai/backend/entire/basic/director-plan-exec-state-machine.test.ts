import { test } from 'vitest'
import { createPlanExecNode } from '../../../../../src/main/services/ai/director/node/planExecNode'
import {
  createInitialAiRunState,
  type DirectorGraphState
} from '../../../../../src/main/services/ai/director/state/schema'
import type {
  AiArtifactRef,
  AiRunEvent,
  AiPlanTask
} from '../../../../../src/shared/types'
import type {
  DirectorNodeContext,
  HumanTaskOutput,
  HumanTaskRunner
} from '../../../../../src/main/services/ai/types'

const buildArtifact = (path: string, summary: string): AiArtifactRef => ({
  kind: 'file',
  capability: 'docx',
  path,
  fileName: path.split('/').at(-1) || 'artifact.docx',
  operation: 'created',
  summary
})

const isEventType = <TType extends AiRunEvent['type']>(
  event: AiRunEvent,
  type: TType
): event is Extract<AiRunEvent, { type: TType }> => event.type === type

test('director-plan-exec-state-machine', async () => {
  const events: AiRunEvent[] = []
  const ctx: DirectorNodeContext = {
    runId: 'director-plan-exec-run',
    checkCancelled: () => undefined,
    chatStructured: async () => {
      throw new Error('chatStructured should not be called in planExec state-machine test')
    },
    sendEvent: (event) => {
      events.push(event)
    },
    loadHistory: async () => ({
      recentTurnsText: '',
      sessionSummaryText: ''
    }),
    selectedScopeSummary: 'workspace: default'
  }
  const calls: string[] = []
  const runHumanTask: HumanTaskRunner = async (taskInput): Promise<HumanTaskOutput> => {
    calls.push(taskInput.taskId)
    return {
      taskId: taskInput.taskId,
      status: 'completed',
      summary: '子任务已完成。',
      deliveryMarkdown: '# 子任务交付\n\n已完成当前子任务。',
      artifacts: [buildArtifact('/tmp/plan-exec-output.docx', 'plan exec artifact')]
    }
  }
  const node = createPlanExecNode({
    ctx,
    runHumanTask
  })
  const initialState: DirectorGraphState = {
    ...createInitialAiRunState({
      runId: 'director-plan-exec-run',
      sessionId: 'test-session',
      input: '整理资料'
    }),
    directorStage: 'director_plan_exec',
    plan: [
      {
        id: 'task-1',
        title: '整理事实',
        userInput: '收集并整理资料中的关键事实',
        status: 'ready'
      }
    ] satisfies AiPlanTask[]
  }

  const firstPatch = await node(initialState)
  if (firstPatch.plan?.[0]?.status !== 'running') {
    throw new Error(`expected running plan after first pass: ${JSON.stringify(firstPatch)}`)
  }
  if (firstPatch.planExecPendingTaskIndex !== 0 || calls.length !== 0) {
    throw new Error(`expected first pass to only mark running: ${JSON.stringify({ firstPatch, calls })}`)
  }
  const firstState = {
    ...initialState,
    ...firstPatch
  } satisfies DirectorGraphState
  const secondPatch = await node(firstState)
  if (!secondPatch.planExecPendingTaskOutput || calls.join(',') !== 'task-1') {
    throw new Error(
      `expected second pass to dispatch human task once: ${JSON.stringify({ secondPatch, calls })}`
    )
  }
  const secondState = {
    ...firstState,
    ...secondPatch
  } satisfies DirectorGraphState
  const thirdPatch = await node(secondState)

  const lifecycleEvents = events.filter(
    (event) => isEventType(event, 'task_started') || isEventType(event, 'task_completed')
  )

  if (
    thirdPatch.plan?.[0]?.status !== 'completed' ||
    thirdPatch.dispatchCursor !== 1 ||
    thirdPatch.directorStage !== 'director_synthesis_human' ||
    thirdPatch.planExecPendingTaskIndex !== undefined ||
    thirdPatch.planExecPendingTaskOutput !== undefined
  ) {
    throw new Error(`expected third pass to finalize task: ${JSON.stringify(thirdPatch)}`)
  }
  if (lifecycleEvents.length !== 2) {
    throw new Error(`expected task lifecycle events on dispatched pass: ${JSON.stringify(lifecycleEvents)}`)
  }
})
