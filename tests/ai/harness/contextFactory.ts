import { randomUUID } from 'node:crypto'
import type { AiRunContext } from '../../../src/main/services/ai/types'
import type { AiApprovalDecision, AiApprovalRequest } from '../../../src/main/services/ai/types'
import type { JsonObject } from '../../../src/shared/types'
import type { EventCollector } from './eventCollector'
import type { ApprovalPolicy, ApprovalResolver, LiveLlmConfig } from './types'

const buildApprovalResolver = (
  policy: ApprovalPolicy | ApprovalResolver | undefined
): ApprovalResolver => {
  if (typeof policy === 'function') return policy
  if (policy === 'deny-all') {
    return () => ({ approved: false, reason: 'approval denied by test policy: deny-all' })
  }
  if (policy === 'deny-medium-high') {
    return () => ({ approved: false, reason: 'approval denied by test policy: deny-medium-high' })
  }
  return () => ({ approved: true })
}

const buildDocumentsStoreStub = () => ({
  hybridSearch: async () => [],
  vectorSearch: async () => [],
  ftsSearch: async () => [],
  listDocuments: async () => ({ items: [], total: 0 })
})

const buildEmbeddingServiceStub = () => ({
  embed: async () => ({
    data: new Float32Array(768),
    dims: [1, 768] as [number, number]
  })
})

export const createTestAiRunContext = (input: {
  runId?: string
  sessionId?: string
  workspaceRootPath: string
  eventCollector: EventCollector
  selectedDocumentIds?: string[]
  approvalPolicy?: ApprovalPolicy | ApprovalResolver
  liveModelConfig?: LiveLlmConfig
}): AiRunContext => {
  const runId = input.runId || randomUUID()
  const sessionId = input.sessionId || 'test-session'
  const resolveApproval = buildApprovalResolver(input.approvalPolicy)
  const documentsStoreStub = buildDocumentsStoreStub()
  const embeddingServiceStub = buildEmbeddingServiceStub()

  const requestApproval = async (request: AiApprovalRequest): Promise<AiApprovalDecision> => {
    const approvalId = randomUUID()
    input.eventCollector.add({
      type: 'approval_required',
      runId,
      taskId: request.taskId,
      approvalId,
      command: request.command,
      riskLevel: request.riskLevel,
      reason: request.reason,
      createdAt: Date.now(),
      stage: request.stage,
      internal: request.internal
    })
    const decision = resolveApproval(request)
    input.eventCollector.add({
      type: 'approval_decision',
      runId,
      taskId: request.taskId,
      approvalId,
      approved: decision.approved,
      reason: decision.reason,
      decidedAt: Date.now(),
      stage: request.stage,
      internal: request.internal
    })
    return decision
  }

  const context = {
    runId,
    sessionId,
    selectedDocumentIds: input.selectedDocumentIds,
    workspace: {
      workspaceId: 'test-workspace',
      rootPath: input.workspaceRootPath
    },
    checkCancelled: () => undefined,
    chatJson: async <T extends JsonObject>(): Promise<T> => {
      throw new Error('chatJson is not available in this test harness context')
    },
    sendEvent: (event: Parameters<AiRunContext['sendEvent']>[0]) => {
      input.eventCollector.add(event)
    },
    requestApproval,
    loadHistory: async () => ({
      recentTurnsText: '',
      sessionSummaryText: ''
    }),
    getModelConfig: async () => {
      if (!input.liveModelConfig) {
        throw new Error('live model config is required for this test case')
      }
      return input.liveModelConfig
    },
    documentsStore: documentsStoreStub,
    embeddingService: embeddingServiceStub
  }

  return context as AiRunContext
}
