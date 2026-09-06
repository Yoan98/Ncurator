import type { AiRunState } from '../types'

export const DEFAULT_AI_RUN_STATUS: AiRunState['status'] = 'running'

export const createDefaultFinalArtifacts = (): AiRunState['finalArtifacts'] => []

export const createInitialAiRunState = (input: {
  runId: string
  partnerId: string
  input: string
}): AiRunState => ({
  runId: input.runId,
  partnerId: input.partnerId,
  status: DEFAULT_AI_RUN_STATUS,
  input: input.input,
  finalArtifacts: createDefaultFinalArtifacts()
})

export const createCompletedAiRunState = (input: {
  runId: string
  partnerId: string
  input: string
  finalDeliveryMarkdown: string
  finalArtifacts?: AiRunState['finalArtifacts']
}): AiRunState => ({
  ...createInitialAiRunState(input),
  status: 'completed',
  finalDeliveryMarkdown: input.finalDeliveryMarkdown,
  finalArtifacts: input.finalArtifacts || createDefaultFinalArtifacts()
})

export const createCancelledAiRunState = (input: {
  runId: string
  partnerId: string
  input: string
}): AiRunState => ({
  ...createInitialAiRunState(input),
  status: 'cancelled',
  error: '已取消',
  failureCode: 'user_cancelled'
})

export const createFailedAiRunState = (input: {
  runId: string
  partnerId: string
  input: string
  error: string
  failureSource: NonNullable<AiRunState['failureSource']>
  failureHttpStatus?: number
  failureProviderCode?: string
  failureCode?: AiRunState['failureCode']
}): AiRunState => ({
  ...createInitialAiRunState(input),
  status: 'failed',
  error: input.error,
  failureSource: input.failureSource,
  failureHttpStatus: input.failureHttpStatus,
  failureProviderCode: input.failureProviderCode,
  failureCode: input.failureCode
})
