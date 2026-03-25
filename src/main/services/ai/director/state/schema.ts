import { StateSchema } from '@langchain/langgraph'
import { aiRunStateFieldSchemas } from '../../schema'
import { humanTaskOutputSchema } from '../../human/schema'
import type { AiRunState, HumanTaskOutput } from '../../types'
import { z } from 'zod/v4'

export type DirectorGraphState = AiRunState & {
  planExecPendingTaskIndex?: number
  planExecPendingTaskOutput?: HumanTaskOutput
}

export const DEFAULT_AI_RUN_STATUS: AiRunState['status'] = 'running'
export const DEFAULT_AI_DIRECTOR_STAGE: AiRunState['directorStage'] = 'director_intent'
export const DEFAULT_CONTEXT_ROUNDS: AiRunState['contextRounds'] = 0
export const DEFAULT_DISPATCH_CURSOR: AiRunState['dispatchCursor'] = 0

export const createDefaultContextEvidence = (): AiRunState['contextEvidence'] => []
export const createDefaultAiPlan = (): AiRunState['plan'] => []
export const createDefaultFinalArtifacts = (): AiRunState['finalArtifacts'] => []

export const createDefaultAiRunStateFields = (): Pick<
  AiRunState,
  | 'status'
  | 'directorStage'
  | 'contextRounds'
  | 'contextEvidence'
  | 'plan'
  | 'dispatchCursor'
  | 'finalArtifacts'
> => ({
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

export const toPublicAiRunState = (state: DirectorGraphState): AiRunState => {
  const { planExecPendingTaskIndex: _planExecPendingTaskIndex, planExecPendingTaskOutput: _planExecPendingTaskOutput, ...publicState } =
    state
  return publicState
}

export const createDirectorRunStateSchema = () => {
  return new StateSchema({
    runId: aiRunStateFieldSchemas.runId,
    sessionId: aiRunStateFieldSchemas.sessionId,
    status: aiRunStateFieldSchemas.status.default(DEFAULT_AI_RUN_STATUS),
    input: aiRunStateFieldSchemas.input,
    directorStage: aiRunStateFieldSchemas.directorStage.default(DEFAULT_AI_DIRECTOR_STAGE),
    contextRounds: aiRunStateFieldSchemas.contextRounds.default(DEFAULT_CONTEXT_ROUNDS),
    contextObjective: aiRunStateFieldSchemas.contextObjective,
    contextEvidence: aiRunStateFieldSchemas.contextEvidence.default(createDefaultContextEvidence),
    plan: aiRunStateFieldSchemas.plan.default(createDefaultAiPlan),
    dispatchCursor: aiRunStateFieldSchemas.dispatchCursor.default(DEFAULT_DISPATCH_CURSOR),
    error: aiRunStateFieldSchemas.error,
    finalDeliveryMarkdown: aiRunStateFieldSchemas.finalDeliveryMarkdown,
    finalArtifacts: aiRunStateFieldSchemas.finalArtifacts.default(createDefaultFinalArtifacts),
    planExecPendingTaskIndex: z.number().int().min(0).optional(),
    planExecPendingTaskOutput: humanTaskOutputSchema.optional()
  })
}
