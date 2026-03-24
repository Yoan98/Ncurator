import type { AiRunState } from '../types'

export const createDefaultAiRunStateFields = () => ({
  status: 'running' as const,
  directorStage: 'director_intent' as const,
  contextRounds: 0,
  contextEvidence: [] as AiRunState['contextEvidence'],
  plan: [] as AiRunState['plan'],
  dispatchCursor: 0,
  finalArtifacts: [] as AiRunState['finalArtifacts']
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
