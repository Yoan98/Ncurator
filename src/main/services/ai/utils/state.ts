import type { AiRunState } from '../types'

export const DEFAULT_AI_RUN_STATUS: AiRunState['status'] = 'running'
export const DEFAULT_AI_DIRECTOR_STAGE: AiRunState['directorStage'] = 'director_intent'
export const DEFAULT_CONTEXT_ROUNDS: AiRunState['contextRounds'] = 0
export const DEFAULT_DISPATCH_CURSOR: AiRunState['dispatchCursor'] = 0

export const createDefaultContextEvidence = (): AiRunState['contextEvidence'] => []
export const createDefaultAiPlan = (): AiRunState['plan'] => []
export const createDefaultFinalArtifacts = (): AiRunState['finalArtifacts'] => []

export const createDefaultAiRunStateFields = () => ({
  status: DEFAULT_AI_RUN_STATUS,
  directorStage: DEFAULT_AI_DIRECTOR_STAGE,
  contextRounds: DEFAULT_CONTEXT_ROUNDS,
  contextEvidence: createDefaultContextEvidence(),
  plan: createDefaultAiPlan(),
  dispatchCursor: DEFAULT_DISPATCH_CURSOR,
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
