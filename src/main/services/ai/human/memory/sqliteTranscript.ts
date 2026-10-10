import type {
  ChatMessageLogStore,
  MessageLogScope
} from '../../../storage/domains/ChatMessageLogStore'
import type { AiTranscript } from '../../types'

export const createSqliteTranscript = (
  store: ChatMessageLogStore,
  scope: MessageLogScope,
  runId: string
): AiTranscript => ({
  append: async (entries, options) => {
    await store.appendBatch({ ...scope, runId: options?.runId || runId, entries })
  },
  load: () => store.list(scope.partnerId, scope.subagentId)
})
