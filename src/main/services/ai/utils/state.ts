import type { AiRunState } from '../types'

export const createDefaultAiRunStatus = (): AiRunState['status'] => 'running'

export const createDefaultDirectorStage = (): AiRunState['directorStage'] => 'director_intent'

export const createDefaultContextRounds = (): AiRunState['contextRounds'] => 0

export const createDefaultContextEvidence = (): AiRunState['contextEvidence'] => []

export const createDefaultPlan = (): AiRunState['plan'] => []

export const createDefaultDispatchCursor = (): AiRunState['dispatchCursor'] => 0

export const createDefaultFinalArtifacts = (): AiRunState['finalArtifacts'] => []

export const createDefaultAiRunStateFields = () => ({
  status: createDefaultAiRunStatus(),
  directorStage: createDefaultDirectorStage(),
  contextRounds: createDefaultContextRounds(),
  contextEvidence: createDefaultContextEvidence(),
  plan: createDefaultPlan(),
  dispatchCursor: createDefaultDispatchCursor(),
  finalArtifacts: createDefaultFinalArtifacts()
})

export const createInitialAiRunState = (input: {
  runId: string
  sessionId: string
  input: string
}): AiRunState => ({
  runId: input.runId,
  sessionId: input.sessionId,
  input: input.input,
  ...createDefaultAiRunStateFields()
})

export const createCancelledAiRunState = (input: {
  runId: string
  sessionId: string
  input: string
}): AiRunState => ({
  ...createInitialAiRunState(input),
  status: 'cancelled',
  directorStage: 'director_complete',
  error: 'cancelled'
})

export const createFailedAiRunState = (input: {
  runId: string
  sessionId: string
  input: string
  error: string
}): AiRunState => ({
  ...createInitialAiRunState(input),
  status: 'failed',
  directorStage: 'director_complete',
  error: input.error
})
