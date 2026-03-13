import { AiRunService } from '../../../src/main/services/ai/AiRunService'
import { buildMainGraph } from '../../../src/main/services/ai/graph/mainGraph'
import type {
  AiApprovalDecision,
  AiApprovalRequest,
  AiRunDeps,
  AiRunState,
  HumanRunDispatchOptions
} from '../../../src/main/services/ai/types'
import type {
  ChatMessage,
  ChatSessionMemory,
  HumanTaskInput,
  HumanTaskOutput,
  JsonObject
} from '../../../src/shared/types'
import { createTestAiRunContext } from './contextFactory'
import type { EventCollector } from './eventCollector'
import { loadLiveLlmConfigFromEnv } from './llmConfig'
import type { ApprovalPolicy, TestDocumentsStoreOverrides } from './types'

type ChatJsonPayload = {
  system: string
  user: string
  temperature?: number
}

type HumanDispatchCall = {
  taskId: string
  objective: string
  options: HumanRunDispatchOptions
}

export type DeterministicMainContextRunResult = {
  finalState: AiRunState
  chatJsonCalls: ChatJsonPayload[]
  chatJsonResults: JsonObject[]
  humanDispatchCalls: HumanDispatchCall[]
}

type ScriptedHumanTaskResponse = {
  taskId: string
  output: HumanTaskOutput
}

const buildEmptyDocumentsStore = (overrides: TestDocumentsStoreOverrides | undefined) => ({
  hybridSearch: overrides?.hybridSearch || (async () => []),
  vectorSearch: overrides?.vectorSearch || (async () => []),
  ftsSearch: overrides?.ftsSearch || (async () => []),
  listDocuments: overrides?.listDocuments || (async () => ({ items: [], total: 0 }))
})

const buildEmbeddingServiceStub = () => ({
  embed: async () => ({
    data: new Float32Array(768),
    dims: [1, 768] as [number, number]
  })
})

const resolveApproval = (
  policy: ApprovalPolicy | undefined,
  request: AiApprovalRequest
): AiApprovalDecision => {
  if (policy === 'deny-all') {
    return { approved: false, reason: 'approval denied by test policy: deny-all' }
  }
  if (policy === 'deny-medium-high' && (request.riskLevel === 'medium' || request.riskLevel === 'high')) {
    return { approved: false, reason: 'approval denied by test policy: deny-medium-high' }
  }
  return { approved: true }
}

export const runDeterministicMainContextGraph = async (input: {
  runId: string
  sessionId?: string
  workspaceRootPath: string
  eventCollector: EventCollector
  userInput: string
  maxContextRounds?: number
  bindWorkspace?: boolean
  selectedDocumentIds?: string[]
  approvalPolicy?: ApprovalPolicy
  historyOverride?: {
    recentTurnsText: string
    sessionSummaryText: string
  }
  chatJsonResponses: JsonObject[]
  humanTaskResponses: ScriptedHumanTaskResponse[]
}): Promise<DeterministicMainContextRunResult> => {
  const sessionId = input.sessionId || 'test-session'
  const chatJsonQueue = [...input.chatJsonResponses]
  const humanTaskMap = new Map(
    input.humanTaskResponses.map((item) => [item.taskId, item.output] as const)
  )
  const chatJsonCalls: ChatJsonPayload[] = []
  const chatJsonResults: JsonObject[] = []
  const humanDispatchCalls: HumanDispatchCall[] = []

  const ctx = createTestAiRunContext({
    runId: input.runId,
    sessionId,
    workspaceRootPath: input.workspaceRootPath,
    eventCollector: input.eventCollector,
    bindWorkspace: input.bindWorkspace,
    selectedDocumentIds: input.selectedDocumentIds,
    approvalPolicy: input.approvalPolicy,
    historyOverride: input.historyOverride,
    chatJsonOverride: async <T extends JsonObject>(payload: ChatJsonPayload): Promise<T> => {
      chatJsonCalls.push(payload)
      const next = chatJsonQueue.shift()
      if (!next) {
        throw new Error(`chatJson response queue exhausted after ${chatJsonCalls.length} calls`)
      }
      chatJsonResults.push(next)
      return next as T
    }
  })

  const runHumanTask = async (
    taskInput: HumanTaskInput,
    options: HumanRunDispatchOptions
  ): Promise<HumanTaskOutput> => {
    humanDispatchCalls.push({
      taskId: taskInput.taskId,
      objective: taskInput.objective,
      options
    })
    const output = humanTaskMap.get(taskInput.taskId)
    if (!output) {
      throw new Error(`missing scripted human output for taskId=${taskInput.taskId}`)
    }
    ctx.sendEvent({
      type: 'task_delivery_ready',
      runId: input.runId,
      taskId: taskInput.taskId,
      summary: output.summary,
      deliveryMarkdown: output.deliveryMarkdown,
      createdAt: Date.now(),
      internal: options.internalDelivery,
      stage: 'human_response'
    })
    if (options.streamAnswer) {
      ctx.sendEvent({
        type: 'answer_completed',
        runId: input.runId,
        taskId: taskInput.taskId,
        text: output.deliveryMarkdown,
        stage: 'human_response'
      })
    }
    return output
  }

  const graph = buildMainGraph({
    ctx,
    maxContextRounds: input.maxContextRounds,
    runHumanTask
  })

  const finalState = (await graph.invoke({
    runId: input.runId,
    sessionId,
    status: 'running',
    input: input.userInput,
    mainStage: 'main_intent',
    plan: [],
    contextRounds: 0,
    contextEvidence: [],
    dispatchCursor: 0
  } as AiRunState)) as AiRunState

  return {
    finalState,
    chatJsonCalls,
    chatJsonResults,
    humanDispatchCalls
  }
}

export const runLiveMainRuntime = async (input: {
  runId: string
  sessionId?: string
  workspaceRootPath: string
  eventCollector: EventCollector
  userInput: string
  bindWorkspace?: boolean
  selectedDocumentIds?: string[]
  allowNonLocal?: boolean
  approvalPolicy?: ApprovalPolicy
  historyMessages?: ChatMessage[]
  sessionMemory?: ChatSessionMemory
  documentsStoreOverrides?: TestDocumentsStoreOverrides
}): Promise<AiRunState> => {
  const sessionId = input.sessionId || 'test-session'
  const liveConfig = loadLiveLlmConfigFromEnv()
  const documentsStore = buildEmptyDocumentsStore(input.documentsStoreOverrides)
  const embeddingService = buildEmbeddingServiceStub()

  const requestApproval = async (request: AiApprovalRequest): Promise<AiApprovalDecision> => {
    const decision = resolveApproval(input.approvalPolicy, request)
    input.eventCollector.add({
      type: 'approval_required',
      runId: input.runId,
      taskId: request.taskId,
      approvalId: `${request.taskId}-approval`,
      command: request.command,
      riskLevel: request.riskLevel,
      reason: request.reason,
      createdAt: Date.now(),
      stage: request.stage,
      internal: request.internal
    })
    input.eventCollector.add({
      type: 'approval_decision',
      runId: input.runId,
      taskId: request.taskId,
      approvalId: `${request.taskId}-approval`,
      approved: decision.approved,
      reason: decision.reason,
      decidedAt: Date.now(),
      stage: request.stage,
      internal: request.internal
    })
    return decision
  }

  const deps = {
    llmStore: {
      getActive: async () => liveConfig
    },
    chatStore: {
      getRecentChatMessages: async () => input.historyMessages || [],
      getSessionMemory: async () => input.sessionMemory || null
    },
    documentsStore,
    embeddingService,
    draftReviewService: {
      registerDocxOpen: () => undefined,
      registerDocxChanges: () => undefined,
      registerDocxPreview: () => undefined
    },
    isCancelled: () => false,
    sendEvent: (event: Parameters<AiRunDeps['sendEvent']>[0]) => {
      input.eventCollector.add(event)
    },
    requestApproval
  } as AiRunDeps

  return AiRunService.getInstance().run(
    {
      runId: input.runId,
      sessionId,
      input: input.userInput,
      selectedDocumentIds: input.selectedDocumentIds,
      allowNonLocal: input.allowNonLocal,
      workspace:
        input.bindWorkspace === false
          ? undefined
          : {
              workspaceId: 'test-workspace',
              rootPath: input.workspaceRootPath
            }
    },
    deps
  )
}
