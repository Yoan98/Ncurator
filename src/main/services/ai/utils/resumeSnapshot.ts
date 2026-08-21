import type {
  ChatSessionResumeSnapshot,
  JsonObject,
  SelectedReference,
  WorkspaceRuntimeBinding
} from '../../../../shared/types'
import type { ChatStore } from '../../storage/domains/ChatStore'
import type { AiRunStartPayload } from '../types'
import type { HumanResumeSnapshot } from '../types'
import type { HumanState, HumanTaskContext } from '../human/types'
import { createDefaultHumanTrace, createInitialHumanState } from '../human/state/schema'

const toJsonObject = (value: HumanResumeSnapshot): JsonObject =>
  JSON.parse(JSON.stringify(value)) as JsonObject

const cloneSelectedReferences = (
  references: SelectedReference[] | undefined
): SelectedReference[] => JSON.parse(JSON.stringify(references || [])) as SelectedReference[]

const cloneWorkspace = (
  workspace: WorkspaceRuntimeBinding | undefined
): WorkspaceRuntimeBinding | undefined =>
  workspace ? (JSON.parse(JSON.stringify(workspace)) as WorkspaceRuntimeBinding) : undefined

export const createHumanTaskContext = (originalGoal: string): HumanTaskContext => ({
  originalGoal: String(originalGoal || '').trim(),
  recoveryHistory: []
})

export const renderHumanTaskGoal = (taskContext: HumanTaskContext): string =>
  String(taskContext.originalGoal || '').trim()

export const renderResumeMessages = (taskContext: HumanTaskContext | undefined): string => {
  const history = taskContext?.recoveryHistory || []
  if (history.length === 0) return ''
  return history
    .map((item, index) => `${String(index + 1)}. ${String(item.userInput || '').trim()}`)
    .join('\n')
}

const resolveTaskContext = (state: HumanState): HumanTaskContext =>
  state.task.taskContext || createHumanTaskContext(state.task.userInput)

const buildInterruptedTaskContext = (
  state: HumanState,
  reason: ChatSessionResumeSnapshot['reason']
): HumanTaskContext => ({
  ...resolveTaskContext(state),
  currentInterruption: { reason }
})

export const buildHumanResumeSnapshot = (
  state: HumanState,
  reason: ChatSessionResumeSnapshot['reason']
): HumanResumeSnapshot => ({
  schemaVersion: 3,
  taskContext: buildInterruptedTaskContext(state, reason),
  memory: {
    todolist: state.memory.todolist,
    conversation: state.memory.conversation,
    taskRun: state.memory.taskRun
  },
  skills: {
    learnedSkillIds: state.skills.learnedSkillIds
  },
  execution: {
    pendingDecisionHint: state.execution.pendingDecisionHint,
    deliveryGuidanceItems: state.execution.deliveryGuidanceItems,
    artifacts: state.execution.artifacts,
    finalizationReason: state.execution.finalizationReason
  }
})

export const serializeHumanResumeSnapshot = (
  state: HumanState,
  reason: ChatSessionResumeSnapshot['reason']
): JsonObject => toJsonObject(buildHumanResumeSnapshot(state, reason))

export const saveHumanResumeSnapshot = async (input: {
  chatStore: ChatStore
  sessionId: string
  runId: string
  userInput: string
  reason: ChatSessionResumeSnapshot['reason']
  selectedReferences?: SelectedReference[]
  workspace?: AiRunStartPayload['workspace']
  humanState: HumanState
  errorMessage?: string
  updatedAt?: number
}): Promise<void> => {
  await input.chatStore.saveSessionResumeSnapshot(input.sessionId, {
    reason: input.reason,
    runId: input.runId,
    userInput: String(input.userInput || ''),
    selectedReferences: cloneSelectedReferences(input.selectedReferences),
    workspace: cloneWorkspace(input.workspace),
    humanState: serializeHumanResumeSnapshot(input.humanState, input.reason),
    errorMessage: String(input.errorMessage || ''),
    updatedAt: input.updatedAt || Date.now()
  })
}

export const restoreHumanStateFromResumeSnapshot = (input: {
  runId: string
  userInput: string
  reason: ChatSessionResumeSnapshot['reason']
  snapshot: JsonObject
}): HumanState => {
  const baseState = createInitialHumanState({
    taskId: input.runId,
    userInput: input.userInput
  })
  const snapshot = input.snapshot as Partial<HumanResumeSnapshot>
  const previousTaskContext = snapshot.taskContext || createHumanTaskContext(input.userInput)
  const interruptionReason = previousTaskContext.currentInterruption?.reason || input.reason
  const taskContext: HumanTaskContext = {
    originalGoal: previousTaskContext.originalGoal,
    recoveryHistory: [
      ...previousTaskContext.recoveryHistory,
      {
        interruptionReason,
        userInput: input.userInput
      }
    ]
  }
  const taskGoal = renderHumanTaskGoal(taskContext)

  return {
    ...baseState,
    task: {
      taskId: input.runId,
      userInput: taskGoal,
      taskContext
    },
    memory: {
      todolist: snapshot.memory?.todolist || baseState.memory.todolist,
      conversation: snapshot.memory?.conversation || baseState.memory.conversation,
      taskRun: snapshot.memory?.taskRun || baseState.memory.taskRun
    },
    skills: {
      learnedSkillIds: snapshot.skills?.learnedSkillIds || baseState.skills.learnedSkillIds
    },
    execution: {
      ...baseState.execution,
      stage: 'brain',
      status: 'running',
      pendingDecisionHint: {
        code: 'run_resumed_after_interruption',
        detail: {
          reason: input.reason
        }
      },
      deliveryGuidanceItems: snapshot.execution?.deliveryGuidanceItems,
      artifacts: snapshot.execution?.artifacts || [],
      finalizationReason: snapshot.execution?.finalizationReason
    },
    result: undefined,
    trace: createDefaultHumanTrace()
  }
}

export const resolveResumeSelectedReferences = (input: {
  payloadSelectedReferences?: SelectedReference[]
  snapshotSelectedReferences?: SelectedReference[]
}): SelectedReference[] | undefined => {
  if (Array.isArray(input.payloadSelectedReferences)) {
    return cloneSelectedReferences(input.payloadSelectedReferences)
  }
  if (
    Array.isArray(input.snapshotSelectedReferences) &&
    input.snapshotSelectedReferences.length > 0
  ) {
    return cloneSelectedReferences(input.snapshotSelectedReferences)
  }
  return undefined
}

export const resolveResumeWorkspace = (input: {
  payloadWorkspace?: WorkspaceRuntimeBinding
  snapshotWorkspace?: WorkspaceRuntimeBinding
}): WorkspaceRuntimeBinding | undefined =>
  cloneWorkspace(input.payloadWorkspace || input.snapshotWorkspace)
