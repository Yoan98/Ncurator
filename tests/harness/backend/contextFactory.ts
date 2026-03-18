import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { randomUUID } from 'node:crypto'
import { createChatModel } from '../../../src/main/services/llm/chatModel'
import type { DocxChangedBlock, DocxOp } from '../../../src/main/services/ai/tools/docx/types'
import type { AiRunContext } from '../../../src/main/services/ai/types'
import type { AiApprovalDecision, AiApprovalRequest } from '../../../src/main/services/ai/types'
import type { HumanStepDecision, JsonObject } from '../../../src/shared/types'
import type { EventCollector } from '../core/eventCollector'
import type {
  ApprovalPolicy,
  ApprovalResolver,
  CreateAiRunContextInput,
  LiveLlmConfig,
  TestDocumentsStoreOverrides,
  TestToolExecutionOverride
} from './test-types'

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

type ToolExecutionOverrideResolver = (input: {
  toolName: string
  args: JsonObject
}) => TestToolExecutionOverride['result'] | undefined

const buildDocumentsStoreStub = (overrides: TestDocumentsStoreOverrides | undefined) => ({
  hybridSearch: overrides?.hybridSearch || (async () => []),
  vectorSearch: overrides?.vectorSearch || (async () => []),
  ftsSearch: overrides?.ftsSearch || (async () => []),
  listDocuments: overrides?.listDocuments || (async () => ({ items: [], total: 0 })),
  getDocumentById:
    overrides?.getDocumentById ||
    (async (id: string) => {
      const response = await (overrides?.listDocuments || (async () => ({ items: [], total: 0 })))({
        page: 1,
        pageSize: 100
      })
      return response.items.find((item) => item.id === id) || null
    })
})

const buildEmbeddingServiceStub = () => ({
  embed: async (input: string | string[]) => {
    const rowCount = Array.isArray(input) ? Math.max(1, input.length) : 1
    return {
      data: new Float32Array(rowCount * 768),
      dims: [rowCount, 768] as [number, number]
    }
  }
})

const buildToolExecutionOverrideResolver = (
  overrides: TestToolExecutionOverride[] | undefined
): ToolExecutionOverrideResolver | undefined => {
  if (!overrides || overrides.length === 0) return undefined

  const rules = overrides.map((rule) => ({
    ...rule,
    remainingUses: Math.max(1, Number(rule.remainingUses || 1))
  }))

  return (input) => {
    const matched = rules.find((rule) => rule.toolName === input.toolName && rule.remainingUses > 0)
    if (!matched) return undefined
    matched.remainingUses -= 1
    return matched.result
  }
}

const buildHumanDecisionOverrideResolver = (
  overrides: CreateAiRunContextInput['humanDecisionOverrides']
):
  | (() => HumanStepDecision | undefined)
  | undefined => {
  if (!overrides || overrides.length === 0) return undefined

  const rules = overrides.map((rule) => ({
    ...rule,
    remainingUses: Math.max(1, Number(rule.remainingUses || 1))
  }))

  return () => {
    const matched = rules.find((rule) => rule.remainingUses > 0)
    if (!matched) return undefined
    matched.remainingUses -= 1
    return matched.decision
  }
}

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

type CreateTestAiRunContextInput = CreateAiRunContextInput & {
  runId?: string
  sessionId?: string
  workspaceRootPath: string
  eventCollector: EventCollector
  trackDocxOpen?: (input: { docId: string; sourcePath: string }) => void
  trackDocxChanges?: (input: {
    previousDocId: string
    nextDocId: string
    op: DocxOp
    changedBlocks: DocxChangedBlock[]
  }) => void
  trackDocxPreview?: (input: { docId: string; previewPath: string }) => void
}

export const createTestAiRunContext = (input: CreateTestAiRunContextInput): AiRunContext => {
  const runId = input.runId || randomUUID()
  const sessionId = input.sessionId || 'test-session'
  const bindWorkspace = input.bindWorkspace !== false
  const resolveApproval = buildApprovalResolver(input.approvalPolicy)
  const documentsStoreStub = buildDocumentsStoreStub(input.documentsStoreOverrides)
  const embeddingServiceStub = buildEmbeddingServiceStub()
  const resolveToolExecutionOverride = buildToolExecutionOverrideResolver(input.toolExecutionOverrides)
  const resolveHumanDecisionOverride = buildHumanDecisionOverrideResolver(input.humanDecisionOverrides)

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
    selectedScopeSummary: bindWorkspace
      ? `workspace:test-workspace`
      : input.selectedDocumentIds?.length
        ? `documents:${input.selectedDocumentIds.join(',')}`
        : 'workspace:unbound',
    allowNonLocal: false,
    workspace: bindWorkspace
      ? {
          workspaceId: 'test-workspace',
          rootPath: input.workspaceRootPath
        }
      : undefined,
    checkCancelled: input.checkCancelledOverride || (() => undefined),
    chatJson: async <T extends JsonObject>(payload): Promise<T> => {
      if (input.chatJsonOverride) {
        return input.chatJsonOverride<T>(payload)
      }
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
    loadHistory: async () =>
      input.historyOverride || {
        recentTurnsText: '',
        sessionSummaryText: ''
      },
    trackDocxOpen: input.trackDocxOpen || (() => undefined),
    trackDocxChanges: input.trackDocxChanges || (() => undefined),
    trackDocxPreview: input.trackDocxPreview || (() => undefined),
    resolveToolExecutionOverride,
    resolveHumanDecisionOverride,
    resolveHumanDeliveryOverride: input.humanDeliveryOverride,
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
