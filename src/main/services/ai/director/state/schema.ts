import { StateSchema } from '@langchain/langgraph'
import { aiRunStateFieldSchemas } from '../../schema'
import type { AiRunState } from '../../types'

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
    finalArtifacts: aiRunStateFieldSchemas.finalArtifacts.default(createDefaultFinalArtifacts)
  })
}
