import type { AiRunEvent } from '../../../../src/shared/types'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { hasLiveLlmConfigInEnv, loadLiveLlmConfigFromEnv } from '../../../harness/backend/llmConfig'
import type { BackendTestRuntime, TestCaseDefinition } from '../../../harness/backend/test-types'

type AiHumanCaseDefinition<TResult> = Omit<TestCaseDefinition<TResult>, 'domain' | 'layer' | 'suite'>

export const defineAiHumanCase = <TResult>(definition: AiHumanCaseDefinition<TResult>): void => {
  it(definition.caseId, async () => {
    await runBackendCase({
      ...definition,
      domain: 'ai',
      layer: 'backend',
      suite: 'human'
    })
  })
}

export const defineAiHumanLiveCase = <TResult>(definition: AiHumanCaseDefinition<TResult>): void => {
  const liveEnabled = hasLiveLlmConfigInEnv('primary')
  if (!liveEnabled) {
    it.skip(definition.caseId, () => undefined)
    return
  }

  const runtimeModelName = loadLiveLlmConfigFromEnv('primary').model_name

  it(definition.caseId, async () => {
    await runBackendCase({
      ...definition,
      domain: 'ai',
      layer: 'backend',
      suite: 'human',
      runtimeModelName
    })
  })
}

export const loadPrimaryLiveHumanConfig = () => loadLiveLlmConfigFromEnv('primary')

export const getCollectedEvents = (runtime: BackendTestRuntime): AiRunEvent[] =>
  runtime.eventCollector.snapshot()

export const getEventsByType = <TType extends AiRunEvent['type']>(
  runtime: BackendTestRuntime,
  type: TType
): Array<Extract<AiRunEvent, { type: TType }>> => {
  return getCollectedEvents(runtime).filter((event) => event.type === type) as Array<
    Extract<AiRunEvent, { type: TType }>
  >
}
