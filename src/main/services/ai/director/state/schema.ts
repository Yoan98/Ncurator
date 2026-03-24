import { StateSchema } from '@langchain/langgraph'
import { aiRunStateFieldSchemas } from '../../schema'

export const createDirectorRunStateSchema = () => {
  return new StateSchema({
    runId: aiRunStateFieldSchemas.runId,
    sessionId: aiRunStateFieldSchemas.sessionId,
    status: aiRunStateFieldSchemas.status.default('running'),
    input: aiRunStateFieldSchemas.input,
    directorStage: aiRunStateFieldSchemas.directorStage.default('director_intent'),
    contextRounds: aiRunStateFieldSchemas.contextRounds.default(0),
    contextObjective: aiRunStateFieldSchemas.contextObjective,
    contextEvidence: aiRunStateFieldSchemas.contextEvidence.default(() => []),
    plan: aiRunStateFieldSchemas.plan.default(() => []),
    dispatchCursor: aiRunStateFieldSchemas.dispatchCursor.default(0),
    error: aiRunStateFieldSchemas.error,
    finalDeliveryMarkdown: aiRunStateFieldSchemas.finalDeliveryMarkdown,
    finalArtifacts: aiRunStateFieldSchemas.finalArtifacts.default(() => [])
  })
}
