import type {
  AiArtifactRef,
  AiRunRecord,
  ChatAttachment,
  ChatMessage,
  ChatMessageLogRecord,
  SelectedReference
} from '../types'

const ACTIVE_RUN_STATUSES = new Set<AiRunRecord['status']>(['running', 'waiting_approval'])

const isDeliveryAssistant = (record: ChatMessageLogRecord): boolean =>
  record.entry.kind === 'assistant' && record.entry.toolCalls.length === 0

export const projectAiConversationMessages = (input: {
  partnerId: string
  records: ChatMessageLogRecord[]
  runs: AiRunRecord[]
}): ChatMessage[] => {
  const runs = [...input.runs].sort((left, right) => left.createdAt - right.createdAt)
  const recordsByRun = new Map<string, ChatMessageLogRecord[]>()
  for (const record of input.records) {
    const existing = recordsByRun.get(record.runId) || []
    existing.push(record)
    recordsByRun.set(record.runId, existing)
  }

  const messages: ChatMessage[] = []
  for (const run of runs) {
    const runRecords = (recordsByRun.get(run.id) || []).sort((left, right) => left.seq - right.seq)
    const userRecord = runRecords.find((record) => record.entry.kind === 'user')
    const userEntry = userRecord?.entry
    const userContext =
      userEntry?.kind === 'user'
        ? userEntry.context
        : {
            selectedReferences: run.selectedReferences || [],
            attachments: run.attachments || []
          }

    messages.push({
      id: run.userMessageId,
      partner_id: input.partnerId,
      role: 'user',
      content: run.input,
      timestamp: userRecord?.createdAt ?? run.createdAt,
      selectedReferences: userContext.selectedReferences as SelectedReference[],
      attachments: userContext.attachments as ChatAttachment[]
    })

    const deliveryRecord = [...runRecords].reverse().find(isDeliveryAssistant)
    const deliveryEntry =
      deliveryRecord?.entry.kind === 'assistant' ? deliveryRecord.entry : undefined
    const deliveryContent =
      deliveryEntry?.content ?? (run.finalAnswer || run.partialAnswer || '')

    const isActive = ACTIVE_RUN_STATUSES.has(run.status)
    if (deliveryContent || isActive || run.error) {
      messages.push({
        id: run.assistantMessageId,
        partner_id: input.partnerId,
        role: 'assistant',
        content: deliveryContent,
        timestamp:
          deliveryRecord?.createdAt ?? run.finishedAt ?? run.updatedAt ?? run.createdAt + 1,
        artifacts: run.artifacts as AiArtifactRef[] | undefined,
        linkAccess: deliveryEntry?.linkAccess,
        error: run.status === 'failed' ? true : undefined
      })
    }
  }

  return messages
}

export const mergeConversationMessages = (input: {
  aiMessages: ChatMessage[]
  legacyMessages: ChatMessage[]
}): ChatMessage[] => {
  const aiMessageIds = new Set(input.aiMessages.map((message) => message.id))
  const supplemental = input.legacyMessages.filter((message) => !aiMessageIds.has(message.id))
  return [...input.aiMessages, ...supplemental].sort(
    (left, right) => left.timestamp - right.timestamp
  )
}

export const PARTNER_LIST_EMPTY_PREVIEW = '做点啥呢？'

const PARTNER_LIST_PREVIEW_MAX_CHARS = 40

export const clipPartnerListPreview = (text: string): string | null => {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return null
  return normalized.length > PARTNER_LIST_PREVIEW_MAX_CHARS
    ? `${normalized.slice(0, PARTNER_LIST_PREVIEW_MAX_CHARS)}…`
    : normalized
}
