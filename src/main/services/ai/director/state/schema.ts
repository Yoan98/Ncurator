import { StateSchema } from '@langchain/langgraph'
import { aiRunStateFieldSchemas } from '../../schema'
import {
  createDefaultAiRunStatus,
  createDefaultContextEvidence,
  createDefaultContextRounds,
  createDefaultDirectorStage,
  createDefaultDispatchCursor,
  createDefaultFinalArtifacts,
  createDefaultPlan
} from '../../utils/state'

export const createDirectorRunStateSchema = () => {
  return new StateSchema({
    runId: aiRunStateFieldSchemas.runId,
    sessionId: aiRunStateFieldSchemas.sessionId,
    status: aiRunStateFieldSchemas.status.default(createDefaultAiRunStatus()),
    input: aiRunStateFieldSchemas.input,
    directorStage: aiRunStateFieldSchemas.directorStage.default(createDefaultDirectorStage()),
    contextRounds: aiRunStateFieldSchemas.contextRounds.default(createDefaultContextRounds()),
    contextObjective: aiRunStateFieldSchemas.contextObjective,
    contextEvidence: aiRunStateFieldSchemas.contextEvidence.default(createDefaultContextEvidence),
    plan: aiRunStateFieldSchemas.plan.default(createDefaultPlan),
    dispatchCursor: aiRunStateFieldSchemas.dispatchCursor.default(createDefaultDispatchCursor()),
    error: aiRunStateFieldSchemas.error,
    finalDeliveryMarkdown: aiRunStateFieldSchemas.finalDeliveryMarkdown,
    finalArtifacts: aiRunStateFieldSchemas.finalArtifacts.default(createDefaultFinalArtifacts)
  })
}
