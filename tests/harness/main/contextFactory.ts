import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { randomUUID } from 'node:crypto'
import { createChatModel } from '../../../src/main/services/llm/chatModel'
import type { DocxChangedBlock, DocxOp } from '../../../src/main/services/ai/tools/docx/types'
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

const parseJsonObject = <T extends JsonObject>(text: string): T => {
  const trimmed = String(text || '').trim()
  try {
    return JSON.parse(trimmed) as T
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as T
    }
  }
  throw new Error('无法解析 JSON 输出')
}

export const createTestAiRunContext = (input: {
  runId?: string
  sessionId?: string
  workspaceRootPath: string
  eventCollector: EventCollector
  selectedDocumentIds?: string[]
  approvalPolicy?: ApprovalPolicy | ApprovalResolver
  liveModelConfig?: LiveLlmConfig
  trackDocxOpen?: (input: { docId: string; sourcePath: string }) => void
  trackDocxChanges?: (input: {
    previousDocId: string
    nextDocId: string
    op: DocxOp
    changedBlocks: DocxChangedBlock[]
  }) => void
  trackDocxPreview?: (input: { docId: string; previewPath: string }) => void
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
    chatJson: async <T extends JsonObject>(payload): Promise<T> => {
      if (!input.liveModelConfig) {
        throw new Error('chatJson is not available in this test harness context')
      }
      const model = createChatModel(input.liveModelConfig, {
        temperature: payload.temperature ?? 0.2
      })
      const res = await model.invoke([
        new SystemMessage(payload.system),
        new HumanMessage(payload.user)
      ])
      const text = typeof res?.content === 'string' ? res.content : String(res?.content ?? '')
      if (!text) throw new Error('大模型返回为空')
      return parseJsonObject<T>(text)
    },
    sendEvent: (event: Parameters<AiRunContext['sendEvent']>[0]) => {
      input.eventCollector.add(event)
    },
    requestApproval,
    loadHistory: async () => ({
      recentTurnsText: '',
      sessionSummaryText: ''
    }),
    trackDocxOpen: input.trackDocxOpen || (() => undefined),
    trackDocxChanges: input.trackDocxChanges || (() => undefined),
    trackDocxPreview: input.trackDocxPreview || (() => undefined),
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
