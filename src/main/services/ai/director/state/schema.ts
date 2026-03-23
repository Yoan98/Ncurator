import { StateSchema } from '@langchain/langgraph'
import { aiRunStateFieldSchemas } from '../../schema'
import { createDefaultAiRunStateFields } from '../../utils/state'

export const createDirectorRunStateSchema = () => {
  const defaults = createDefaultAiRunStateFields()

  return new StateSchema({
    runId: aiRunStateFieldSchemas.runId,
    sessionId: aiRunStateFieldSchemas.sessionId,
    status: aiRunStateFieldSchemas.status.default(defaults.status),
    input: aiRunStateFieldSchemas.input,
    directorStage: aiRunStateFieldSchemas.directorStage.default(defaults.directorStage),
    contextRounds: aiRunStateFieldSchemas.contextRounds.default(defaults.contextRounds),
    contextObjective: aiRunStateFieldSchemas.contextObjective,
    contextEvidence: aiRunStateFieldSchemas.contextEvidence.default(() => [...defaults.contextEvidence]),
    plan: aiRunStateFieldSchemas.plan.default(() => [...defaults.plan]),
    dispatchCursor: aiRunStateFieldSchemas.dispatchCursor.default(defaults.dispatchCursor),
    error: aiRunStateFieldSchemas.error,
    finalDeliveryMarkdown: aiRunStateFieldSchemas.finalDeliveryMarkdown,
    finalArtifacts: aiRunStateFieldSchemas.finalArtifacts.default(() => [...defaults.finalArtifacts])
  })
}
