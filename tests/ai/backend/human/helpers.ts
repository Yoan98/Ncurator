import type { AiRunEvent } from '../../../../src/shared/types'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
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
