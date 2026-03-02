import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { AiRunContext, AiRunDeps, AiRunStartPayload } from './types'
import { createChatModel } from '../llm/chatModel'
import type { ChatMessage, ChatSessionMemory, JsonObject } from '../../types/store'

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

const formatTurns = (messages: ChatMessage[]) => {
  return messages
    .map((m) => {
      const role = String(m.role || 'user')
      const content = String(m.content || '')
      return `${role}: ${content}`
    })
    .join('\n')
}

const pushInstruction = (bucket: string[], text: string, maxChars: number) => {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return
  const clipped = normalized.slice(0, Math.max(1, maxChars))
  if (bucket.includes(clipped)) return
  bucket.push(clipped)
}

const buildLocalInstructions = (input: {
  memory: ChatSessionMemory | null
  workspacePolicyProfile?: string
  maxItems: number
  maxChars: number
}): string[] => {
  const items: string[] = []
  const maxItems = Math.max(1, input.maxItems)
  const maxChars = Math.max(20, input.maxChars)
  const policy = String(input.workspacePolicyProfile || '').trim()
  const memory = input.memory

  if (policy) {
    pushInstruction(items, `workspace-policy: ${policy}`, maxChars)
  }

  const pinnedFacts = Array.isArray(memory?.pinnedFacts) ? memory?.pinnedFacts : []
  for (const fact of pinnedFacts) {
    pushInstruction(items, `pinned-fact: ${String(fact || '').trim()}`, maxChars)
    if (items.length >= maxItems) return items
  }

  const userPrefs = Array.isArray(memory?.userPrefs) ? memory?.userPrefs : []
  for (const pref of userPrefs) {
    pushInstruction(items, `user-pref: ${String(pref || '').trim()}`, maxChars)
    if (items.length >= maxItems) return items
  }

  return items.slice(0, maxItems)
}

export const createAiRunContext = (payload: AiRunStartPayload, deps: AiRunDeps): AiRunContext => {
  const checkCancelled = () => {
    if (deps.isCancelled()) {
      const e = new Error('cancelled') as CancelledError
      e.code = 'CANCELLED'
      throw e
    }
  }

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
    const maxLocalInstructionItems = Math.max(
      1,
      Math.min(50, Number(limits?.maxLocalInstructionItems ?? 20))
    )
    const maxLocalInstructionChars = Math.max(
      20,
      Math.min(500, Number(limits?.maxLocalInstructionChars ?? 120))
    )

    const messages = await deps.chatStore.getRecentChatMessages(payload.sessionId, recentTurns)
    const recentTurnsText = clipText(formatTurns(messages), maxRecentTurnsChars)

    const memory = await deps.chatStore.getSessionMemory(payload.sessionId)
    const sessionSummaryText = clipText(String(memory?.summary || ''), maxSummaryChars)
    const localInstructions = buildLocalInstructions({
      memory,
      workspacePolicyProfile: payload.workspace?.policyProfile
        ? String(payload.workspace.policyProfile)
        : undefined,
      maxItems: maxLocalInstructionItems,
      maxChars: maxLocalInstructionChars
    })

    return { recentTurnsText, sessionSummaryText, localInstructions }
  }

  return {
    runId: payload.runId,
    sessionId: payload.sessionId,
    selectedDocumentIds: Array.isArray(payload.selectedDocumentIds)
      ? payload.selectedDocumentIds.map(String).filter(Boolean)
      : undefined,
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
