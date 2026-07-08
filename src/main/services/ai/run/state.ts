import type { AiRunState } from '../types'

export const DEFAULT_AI_RUN_STATUS: AiRunState['status'] = 'running'

export const createDefaultFinalArtifacts = (): AiRunState['finalArtifacts'] => []

export const createInitialAiRunState = (input: {
  runId: string
  sessionId: string
  input: string
}): AiRunState => ({
  runId: input.runId,
  sessionId: input.sessionId,
  status: DEFAULT_AI_RUN_STATUS,
  input: input.input,
  finalArtifacts: createDefaultFinalArtifacts()
})

export const createCompletedAiRunState = (input: {
  runId: string
  sessionId: string
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
  sessionId: string
  input: string
}): AiRunState => ({
  ...createInitialAiRunState(input),
  status: 'cancelled',
  error: '已取消'
})

export const createFailedAiRunState = (input: {
  runId: string
  sessionId: string
  input: string
  error: string
  failureCode?: AiRunState['failureCode']
  resumeSnapshotSaved?: boolean
}): AiRunState => ({
  ...createInitialAiRunState(input),
  status: 'failed',
  error: input.error,
  failureCode: input.failureCode,
  resumeSnapshotSaved: input.resumeSnapshotSaved
})
