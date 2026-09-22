import type { ChatMessageLogStore } from '../storage/domains/ChatMessageLogStore'
import type { WorkbenchUiStore } from '../storage/domains/WorkbenchUiStore'
import { resolveEffectiveContextWindowTokens } from './human/constants'
import { projectMessageLogRecords } from './human/memory/transcript'
import { estimateMessagesForContext } from './human/memory/multimodal'
import { lookupCatalogModelContextTokens } from './modelContextWindow'
import { hasEffectiveImageContextInMessageLog } from '../../../shared/messageLogVisionContext'

export const getAiContextUsage = async (input: {
  partnerId: string
  chatMessageLogStore: ChatMessageLogStore
  workbenchUiStore: WorkbenchUiStore
}): Promise<{
  contextWindowTokens: number
  usedContextTokens: number
  ratio: number
  updatedAt: number
  hasEffectiveImageContext: boolean
}> => {
  const records = await input.chatMessageLogStore.list(input.partnerId)
  const messages = projectMessageLogRecords(records).messages
  const usedContextTokens = estimateMessagesForContext(messages)
  const partnerState = await input.workbenchUiStore.getPartnerState(input.partnerId)
  const contextWindowTokens = resolveEffectiveContextWindowTokens(
    lookupCatalogModelContextTokens(partnerState?.composer.modelSelection.mainModel)
  )
  return {
    contextWindowTokens,
    usedContextTokens,
    ratio: usedContextTokens / contextWindowTokens,
    updatedAt: Date.now(),
    hasEffectiveImageContext: hasEffectiveImageContextInMessageLog(records)
  }
}
