import { randomUUID } from 'node:crypto'
import { invokeStructuredChat } from '../../../src/main/services/ai/structuredOutput'
import type { ResolvedDocxOpenTarget } from '../../../src/main/services/ai/human/tools/docx/review/types'
import type { DocxChangedBlock, DocxOp } from '../../../src/main/services/ai/human/tools/docx/types'
import type { LastBrainDecision } from '../../../src/main/services/ai/human/types'
import type { AiRunContext } from '../../../src/main/services/ai/types'
import type { AiApprovalDecision, AiApprovalRequest } from '../../../src/main/services/ai/types'
import type { EventCollector } from '../core/eventCollector'
import type {
  ApprovalPolicy,
  ApprovalResolver,
  CreateAiRunContextInput,
  TestHumanReasonShortcut,
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
  args: Record<string, unknown>
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

const buildHumanReasonOverrideResolver = (
  overrides: CreateAiRunContextInput['humanReasonOverrides']
):
  | (() => LastBrainDecision | undefined)
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
    if ('action' in matched.output) {
      return translateTestReasonShortcut(matched.output)
    }
    return matched.output
  }
}

const translateTestReasonShortcut = (output: TestHumanReasonShortcut): LastBrainDecision => {
  if (output.action === 'load_skill') {
    const skillIds = Array.isArray(output.skillIds)
      ? output.skillIds
      : output.skillId
        ? [output.skillId]
        : []
    return {
      memoryOps: [],
      decision: {
        summary: output.publicNarrative,
        reason: output.rationale,
        expectedOutcome: '学习所需 skill 后继续推进任务。'
      },
      nextAction: {
        action: 'learning',
        wantLearnSkillIds: skillIds
      }
    }
  }

  if (output.action === 'invoke_tool') {
    return {
      memoryOps: [],
      decision: {
        summary: output.publicNarrative,
        reason: output.rationale,
        expectedOutcome: '执行工具后继续推进任务。'
      },
      nextAction: {
        action: 'hand',
        parallelCallToolParam: [
          {
            toolName: output.toolName,
            args: output.args
          }
        ]
      }
    }
  }

  if (output.action === 'complete_task') {
    return {
      memoryOps: [],
      decision: {
        summary: output.summary,
        reason: output.rationale,
        expectedOutcome: '进入最终完成交付。'
      },
      nextAction: {
        action: 'mouth'
      }
    }
  }

  throw new Error(`unsupported test human reason shortcut: ${String((output as { action?: string }).action || '')}`)
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
  resolveDocxOpenTarget?: (sourcePath: string) => Promise<ResolvedDocxOpenTarget>
}

const buildSelectedScopeSummary = (input: {
  bindWorkspace: boolean
  selectedDocumentIds?: string[]
  allowNonLocal?: boolean
}): string => {
  const parts: string[] = []
  if (input.selectedDocumentIds && input.selectedDocumentIds.length > 0) {
    parts.push(`已选资料文档 ${input.selectedDocumentIds.length} 份。`)
  } else {
    parts.push('当前没有显式选中的资料文档。')
  }

  if (input.bindWorkspace) {
    parts.push('当前已绑定工作区 test-workspace；如需访问文件，请使用工作区内相对路径。')
  } else {
    parts.push('当前未绑定工作区；不要依赖 terminal 或 docx workspace 能力。')
  }

  parts.push(`允许非本地信息: ${input.allowNonLocal ? '是' : '否'}`)
  return parts.join('\n')
}

export const createTestAiRunContext = (input: CreateTestAiRunContextInput): AiRunContext => {
  const runId = input.runId || randomUUID()
  const bindWorkspace = input.bindWorkspace !== false
  const resolveApproval = buildApprovalResolver(input.approvalPolicy)
  const documentsStoreStub = buildDocumentsStoreStub(input.documentsStoreOverrides)
  const embeddingServiceStub = buildEmbeddingServiceStub()
  const resolveToolExecutionOverride = buildToolExecutionOverrideResolver(input.toolExecutionOverrides)
  const resolveBrainDecisionOverride = buildHumanReasonOverrideResolver(input.humanReasonOverrides)
  void input.sessionId
  void input.runtimeSettingsOverride

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
    selectedDocumentIds: input.selectedDocumentIds,
    selectedScopeSummary: buildSelectedScopeSummary({
      bindWorkspace,
      selectedDocumentIds: input.selectedDocumentIds,
      allowNonLocal: input.allowNonLocal
    }),
    allowNonLocal: Boolean(input.allowNonLocal),
    humanRuntimeOverrides: input.humanRuntimeOverrides,
    workspace: bindWorkspace
      ? {
          workspaceId: 'test-workspace',
          rootPath: input.workspaceRootPath
        }
      : undefined,
    checkCancelled: input.checkCancelledOverride || (() => undefined),
    chatStructured: async <T extends Record<string, unknown>>(payload): Promise<T> => {
      if (input.chatStructuredOverride) {
        return input.chatStructuredOverride<T>(payload)
      }
      if (!input.liveModelConfig) {
        throw new Error('chatStructured is not available in this test harness context')
      }
      return invokeStructuredChat({
        caller: payload.caller,
        cfg: input.liveModelConfig,
        schema: payload.schema,
        schemaName: payload.schemaName,
        system: payload.system,
        user: payload.user,
        temperature: payload.temperature
      })
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
    resolveDocxOpenTarget:
      input.resolveDocxOpenTarget ||
      (async (sourcePath) => ({
        openPath: sourcePath,
        trackedSourcePath: sourcePath
      })),
    resolveToolExecutionOverride,
    resolveBrainDecisionOverride,
    resolveHumanDeliveryOverride: input.humanDeliveryOverride
      ? ({ userInput, deliveryMode, summary, state }) => {
          const output = input.humanDeliveryOverride?.({
            userInput,
            deliveryMode,
            status: 'completed',
            summary,
            state
          })
          if (!output) return undefined
          if (typeof output === 'string') {
            return {
              summary,
              deliveryMarkdown: output
            }
          }
          return output
        }
      : undefined,
    documentsStore: documentsStoreStub,
    embeddingService: embeddingServiceStub
  }

  return context as AiRunContext
}
