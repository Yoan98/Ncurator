import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { AiRunContext, AiRunDeps, AiRunStartPayload } from './types'
import type { SourceScopeSelection } from '../../../shared/types'
import { createChatModel } from '../llm/chatModel'
import type { ChatMessage, JsonObject } from '../../types/store'

type CancelledError = Error & { code: 'CANCELLED' }

const parseJsonObject = <T extends JsonObject>(text: string): T => {
  const trimmed = String(text || '').trim()
  try {
    return JSON.parse(trimmed) as T
  } catch (err) {
    void err
  }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    const slice = trimmed.slice(start, end + 1)
    return JSON.parse(slice) as T
  }
  throw new Error('无法解析 JSON 输出')
}

const clipText = (text: string, maxChars: number) => {
  const t = String(text || '')
  if (t.length <= maxChars) return t
  return t.slice(0, maxChars)
}

const collectScopedDocumentIds = (scopes: SourceScopeSelection[] | undefined): string[] => {
  if (!Array.isArray(scopes)) return []
  return Array.from(
    new Set(scopes.flatMap((scope) => (Array.isArray(scope.documentIds) ? scope.documentIds : [])))
  )
    .map((item) => String(item).trim())
    .filter(Boolean)
}

const buildScopeSummary = (scopes: SourceScopeSelection[] | undefined): string => {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return '未选择任何资料范围；仅在需要时使用默认本地资料。'
  }

  return scopes
    .map((scope, index) => {
      const preparedCount = Number(scope.preparedDocumentCount ?? scope.documentIds.length)
      const unpreparedCount = Number(scope.unpreparedFileCount ?? 0)
      const workspaceText = scope.workspace
        ? ` | workspace=${scope.workspace.workspaceId}`
        : ''
      return `${index + 1}. ${scope.scopeType}:${scope.label}${scope.relativePath ? ` (${scope.relativePath})` : ''} | prepared=${preparedCount} | unprepared=${unpreparedCount}${workspaceText}`
    })
    .join('\n')
}

const formatTurns = (messages: ChatMessage[]) => {
  return messages
    .map((m) => {
      const role = String(m.role || 'user')
      const content = String(m.content || '')
      return `${role}: ${content}`
    })
    .join('\n')
}

export const createAiRunContext = (payload: AiRunStartPayload, deps: AiRunDeps): AiRunContext => {
  const checkCancelled = () => {
    if (deps.isCancelled()) {
      const e = new Error('cancelled') as CancelledError
      e.code = 'CANCELLED'
      throw e
    }
  }

  const normalizedScopes = Array.isArray(payload.selectedSourceScopes)
    ? payload.selectedSourceScopes
        .map((scope) => ({
          ...scope,
          sourceId: String(scope.sourceId || '').trim(),
          nodeId: scope.nodeId ? String(scope.nodeId).trim() : undefined,
          label: String(scope.label || '').trim(),
          absolutePath: scope.absolutePath ? String(scope.absolutePath).trim() : undefined,
          relativePath: scope.relativePath ? String(scope.relativePath).trim() : undefined,
          documentIds: Array.isArray(scope.documentIds)
            ? scope.documentIds.map(String).filter(Boolean)
            : [],
          workspace:
            scope.workspace &&
            String(scope.workspace.workspaceId || '').trim() &&
            String(scope.workspace.rootPath || '').trim()
              ? {
                  workspaceId: String(scope.workspace.workspaceId).trim(),
                  rootPath: String(scope.workspace.rootPath).trim(),
                  policyProfile: scope.workspace.policyProfile
                    ? String(scope.workspace.policyProfile)
                    : undefined
                }
              : undefined
        }))
        .filter((scope) => scope.sourceId && scope.label)
    : undefined
  const scopedDocumentIds = collectScopedDocumentIds(normalizedScopes)
  const explicitDocumentIds = Array.isArray(payload.selectedDocumentIds)
    ? payload.selectedDocumentIds.map(String).filter(Boolean)
    : []
  const effectiveDocumentIds = Array.from(new Set([...explicitDocumentIds, ...scopedDocumentIds]))

  const getActiveConfig = async () => {
    const cfg = await deps.llmStore.getActive()
    if (!cfg) throw new Error('未配置可用的大模型，请先在「大模型配置」中设置并启用一个模型')
    return cfg
  }

  const chatJson: AiRunContext['chatJson'] = async <T extends JsonObject>(input): Promise<T> => {
    checkCancelled()
    const { system, user, temperature } = input
    const cfg = await getActiveConfig()
    const model = createChatModel(cfg, { temperature: temperature ?? 0.2 })
    const res = await model.invoke([new SystemMessage(system), new HumanMessage(user)])
    const text = typeof res?.content === 'string' ? res.content : String(res?.content ?? '')
    if (!text) throw new Error('大模型返回为空')
    return parseJsonObject<T>(text)
  }

  const loadHistory: AiRunContext['loadHistory'] = async (limits) => {
    checkCancelled()
    const recentTurns = Math.max(1, Math.min(50, Number(limits?.recentTurns ?? 12)))
    const maxRecentTurnsChars = Math.max(
      500,
      Math.min(20000, Number(limits?.maxRecentTurnsChars ?? 6000))
    )
    const maxSummaryChars = Math.max(200, Math.min(8000, Number(limits?.maxSummaryChars ?? 1200)))

    const messages = await deps.chatStore.getRecentChatMessages(payload.sessionId, recentTurns)
    const recentTurnsText = clipText(formatTurns(messages), maxRecentTurnsChars)

    const memory = await deps.chatStore.getSessionMemory(payload.sessionId)
    const sessionSummaryText = clipText(String(memory?.summary || ''), maxSummaryChars)

    return { recentTurnsText, sessionSummaryText }
  }

  return {
    runId: payload.runId,
    sessionId: payload.sessionId,
    selectedDocumentIds: effectiveDocumentIds.length > 0 ? effectiveDocumentIds : undefined,
    selectedSourceScopes: normalizedScopes,
    selectedScopeSummary: `${buildScopeSummary(normalizedScopes)}\n允许非本地信息: ${
      payload.allowNonLocal ? '是' : '否'
    }`,
    allowNonLocal: Boolean(payload.allowNonLocal),
    workspace: payload.workspace
      ? {
          workspaceId: String(payload.workspace.workspaceId || '').trim(),
          rootPath: String(payload.workspace.rootPath || '').trim(),
          policyProfile: payload.workspace.policyProfile
            ? String(payload.workspace.policyProfile)
            : undefined
        }
      : undefined,
    checkCancelled,
    chatJson,
    sendEvent: deps.sendEvent,
    requestApproval: deps.requestApproval,
    loadHistory,
    getModelConfig: getActiveConfig,
    documentsStore: deps.documentsStore,
    embeddingService: deps.embeddingService
  }
}
