import { StateSchema } from '@langchain/langgraph'
import { aiRunStateFieldSchemas } from '../../schema'
import {
  createDefaultAiPlan,
  createDefaultContextEvidence,
  createDefaultFinalArtifacts,
  DEFAULT_AI_DIRECTOR_STAGE,
  DEFAULT_AI_RUN_STATUS,
  DEFAULT_CONTEXT_ROUNDS,
  DEFAULT_DISPATCH_CURSOR
} from '../../utils/state'

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
