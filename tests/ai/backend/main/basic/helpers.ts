import type { AiRunEvent } from '../../../../../src/shared/types'
import { it } from 'vitest'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { BackendTestRuntime, TestCaseDefinition } from '../../../../harness/backend/test-types'

type AiMainCaseDefinition<TResult> = Omit<TestCaseDefinition<TResult>, 'domain' | 'layer' | 'suite'>

export const defineAiMainCase = <TResult>(definition: AiMainCaseDefinition<TResult>): void => {
  it(definition.caseId, async () => {
    await runBackendCase({
      ...definition,
      domain: 'ai',
      layer: 'backend',
      suite: 'main'
    })
  })
}

export const getEventsByType = <TType extends AiRunEvent['type']>(
  runtime: BackendTestRuntime,
  type: TType
): Array<Extract<AiRunEvent, { type: TType }>> =>
  runtime.eventCollector.snapshot().filter((event) => event.type === type) as Array<
    Extract<AiRunEvent, { type: TType }>
  >
