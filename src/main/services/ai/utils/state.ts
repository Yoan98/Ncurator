import type { AiRunState } from '../types'
import {
  createDefaultAiRunStateFields,
  DEFAULT_AI_DIRECTOR_STAGE,
  DEFAULT_AI_RUN_STATUS,
  DEFAULT_CONTEXT_ROUNDS,
  DEFAULT_DISPATCH_CURSOR,
  createDefaultAiPlan,
  createDefaultContextEvidence,
  createDefaultFinalArtifacts
} from '../director/state/schema'

export {
  DEFAULT_AI_RUN_STATUS,
  DEFAULT_AI_DIRECTOR_STAGE,
  DEFAULT_CONTEXT_ROUNDS,
  DEFAULT_DISPATCH_CURSOR,
  createDefaultContextEvidence,
  createDefaultAiPlan,
  createDefaultFinalArtifacts,
  createDefaultAiRunStateFields
}

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
