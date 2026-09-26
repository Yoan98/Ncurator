import type {
  AiArtifactRef,
  AiRunRecord,
  ChatAttachment,
  ChatMessage,
  ChatMessageLogRecord,
  SelectedReference
} from '../types'

const ACTIVE_RUN_STATUSES = new Set<AiRunRecord['status']>([
  'running',
  'waiting_human',
  'waiting_approval'
])

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
    const userRecords = runRecords.filter((record) => record.entry.kind === 'user')
    const loggedMessageIds = new Set<string>()
    for (const record of userRecords) {
      if (record.entry.kind !== 'user') continue
      const messageId = record.entry.messageId || run.userMessageId
      if (loggedMessageIds.has(messageId)) continue
      loggedMessageIds.add(messageId)
      messages.push({
        id: messageId,
        partner_id: input.partnerId,
        role: 'user',
        content: record.entry.input,
        timestamp: record.createdAt,
        selectedReferences: record.entry.context.selectedReferences as SelectedReference[],
        attachments: record.entry.context.attachments as ChatAttachment[]
      })
    }

    const runUserMessage = messages.find(
      (message) => message.id === run.userMessageId && message.role === 'user'
    )
    if (!loggedMessageIds.has(run.userMessageId)) {
      const userRecord = userRecords[0]
      const userEntry = userRecord?.entry.kind === 'user' ? userRecord.entry : undefined
      const userContext = userEntry?.context || {
        selectedReferences: run.selectedReferences || [],
        attachments: run.attachments || []
      }
      messages.push({
        id: run.userMessageId,
        partner_id: input.partnerId,
        role: 'user',
        content: run.input,
        timestamp: run.createdAt,
        selectedReferences: userContext.selectedReferences as SelectedReference[],
        attachments: userContext.attachments as ChatAttachment[]
      })
    }

    if (run.status === 'context_only') continue

    const deliveryRecord = [...runRecords].reverse().find(isDeliveryAssistant)
    const deliveryEntry =
      deliveryRecord?.entry.kind === 'assistant' ? deliveryRecord.entry : undefined
    const deliveryContent = deliveryEntry?.content ?? (run.finalAnswer || run.partialAnswer || '')

    const isActive = ACTIVE_RUN_STATUSES.has(run.status)
    const hasProcessLog = runRecords.some(
      (record) => record.entry.kind === 'assistant' && record.entry.toolCalls.length > 0
    )
    if (deliveryContent || isActive || run.error || hasProcessLog || run.status === 'continued') {
      messages.push({
        id: run.assistantMessageId,
        partner_id: input.partnerId,
        role: 'assistant',
        content: deliveryContent,
        timestamp:
          run.status === 'continued'
            ? (runUserMessage?.timestamp ?? run.createdAt) + 1
            : (deliveryRecord?.createdAt ?? run.finishedAt ?? run.updatedAt ?? run.createdAt + 1),
        artifacts: run.artifacts as AiArtifactRef[] | undefined,
        linkAccess: deliveryEntry?.linkAccess,
        error: run.status === 'failed' ? true : undefined
      })
    }

    let pendingTimestamp = Math.max(
      run.pendingMessages?.[0]?.createdAt || run.createdAt,
      messages[messages.length - 1]?.timestamp || run.createdAt
    )
    for (const pending of run.pendingMessages || []) {
      pendingTimestamp = Math.max(pending.createdAt, pendingTimestamp + 1)
      messages.push({
        id: pending.id,
        partner_id: input.partnerId,
        role: 'user',
        content: pending.input,
        timestamp: pendingTimestamp,
        contentNodes: pending.contentNodes,
        selectedReferences: pending.selectedReferences,
        attachments: pending.attachments,
        pending: true
      })
    }
  }

  return messages
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
