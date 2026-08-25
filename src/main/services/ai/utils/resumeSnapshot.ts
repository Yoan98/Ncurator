import type {
  ChatSessionResumeSnapshot,
  JsonObject,
  SelectedReference,
  WorkspaceRuntimeBinding
} from '../../../../shared/types'
import type { ChatStore } from '../../storage/domains/ChatStore'
import type { AiRunStartPayload } from '../types'
import type { HumanResumeSnapshot } from '../types'
import type { HumanState } from '../human/types'
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

export const buildHumanResumeSnapshot = (state: HumanState): HumanResumeSnapshot => ({
  schemaVersion: 3,
  memory: {
    plan: state.memory.plan,
    compactions: state.memory.compactions
  },
  skills: {
    learnedSkillIds: state.skills.learnedSkillIds
  },
  execution: {
    deliveryGuidanceItems: state.execution.deliveryGuidanceItems,
    artifacts: state.execution.artifacts
  }
})

export const serializeHumanResumeSnapshot = (state: HumanState): JsonObject =>
  toJsonObject(buildHumanResumeSnapshot(state))

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
    humanState: serializeHumanResumeSnapshot(input.humanState),
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

  return {
    ...baseState,
    task: {
      taskId: input.runId,
      userInput: input.userInput
    },
    memory: {
      plan: snapshot.memory?.plan || baseState.memory.plan,
      compactions: snapshot.memory?.compactions || baseState.memory.compactions
    },
    skills: {
      learnedSkillIds: snapshot.skills?.learnedSkillIds || baseState.skills.learnedSkillIds
    },
    execution: {
      ...baseState.execution,
      stage: 'brain',
      status: 'running',
      deliveryGuidanceItems: snapshot.execution?.deliveryGuidanceItems,
      artifacts: snapshot.execution?.artifacts || []
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
