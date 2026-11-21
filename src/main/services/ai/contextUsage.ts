import type {
  AiContextUsageBasis,
  BrainContextBudgetSnapshot,
  WorkbenchSelectedModel
} from '../../../shared/types'
import type { ChatMessageLogStore } from '../storage/domains/ChatMessageLogStore'
import type { WorkbenchUiStore } from '../storage/domains/WorkbenchUiStore'
import { resolveEffectiveContextWindowTokens } from './human/constants'
import { projectMessageLogRecords } from './human/memory/transcript'
import { estimateMessagesForContext } from './human/memory/multimodal'
import { lookupCatalogModelContextTokens } from './modelContextWindow'
import { hasEffectiveImageContextInMessageLog } from '../../../shared/messageLogVisionContext'

export type AiContextUsage = {
  contextWindowTokens: number
  usedContextTokens: number
  ratio: number
  basis: AiContextUsageBasis
  updatedAt: number
  hasEffectiveImageContext: boolean
}

type ContextUsageModel = Pick<WorkbenchSelectedModel, 'configId' | 'modelName'> | null

export type ContextUsageSample = {
  model: ContextUsageModel
  snapshot: BrainContextBudgetSnapshot
}

const sameModel = (left: ContextUsageModel, right: ContextUsageModel): boolean =>
  left?.configId === right?.configId && left?.modelName === right?.modelName

/** Keep the most informative same-scope sample, without affecting graph budget decisions. */
export const selectContextUsageSample = (
  previous: ContextUsageSample | undefined,
  next: ContextUsageSample
): ContextUsageSample => {
  if (
    previous &&
    sameModel(previous.model, next.model) &&
    previous.snapshot.contextWindowTokens === next.snapshot.contextWindowTokens &&
    (previous.snapshot.basis === 'usage_plus_delta' ||
      previous.snapshot.basis === 'post_compaction') &&
    (next.snapshot.basis === 'initial' || next.snapshot.basis === 'usage_unavailable')
  ) {
    return previous
  }
  return next
}

export const getAiContextUsage = async (input: {
  partnerId: string
  chatMessageLogStore: ChatMessageLogStore
  workbenchUiStore: WorkbenchUiStore
  sample?: ContextUsageSample
}): Promise<AiContextUsage> => {
  const records = await input.chatMessageLogStore.listForModel(input.partnerId)
  const partnerState = await input.workbenchUiStore.getPartnerState(input.partnerId)
  const model = partnerState?.composer.modelSelection.mainModel ?? null
  const contextWindowTokens = resolveEffectiveContextWindowTokens(
    await lookupCatalogModelContextTokens(model)
  )
  const sample = input.sample
  const snapshot =
    sample &&
    sameModel(sample.model, model) &&
    sample.snapshot.contextWindowTokens === contextWindowTokens
      ? sample.snapshot
      : undefined
  const usedContextTokens =
    snapshot?.budgetTokens ??
    estimateMessagesForContext(
      projectMessageLogRecords(records, { includeUserEntries: true }).messages
    )
  return {
    contextWindowTokens,
    usedContextTokens,
    ratio: usedContextTokens / contextWindowTokens,
    basis: snapshot?.basis ?? 'estimate',
    updatedAt: Date.now(),
    hasEffectiveImageContext: hasEffectiveImageContextInMessageLog(records)
  }
}
