import type { HumanDeliveryMode, HumanState, MouthOutput } from '../../../src/main/services/ai/human/types'
import type { AiRunEvent } from '../../../src/shared/types'

export const filterAiRunEventsByType = <TType extends AiRunEvent['type']>(
  events: readonly AiRunEvent[],
  type: TType
): Extract<AiRunEvent, { type: TType }>[] =>
  events.filter(
    (event): event is Extract<AiRunEvent, { type: TType }> => event.type === type
  )

export const createCapturingDeliveryOverride = (input?: {
  summary?: string
  buildMarkdown?:
    | string
    | ((payload: {
        deliveryMode: HumanDeliveryMode
        summary: string
        state: HumanState
      }) => string)
}): {
  override: (payload: {
    userInput: string
    deliveryMode: HumanDeliveryMode
    summary: string
    status: 'completed'
    state: HumanState
  }) => MouthOutput
  getCapturedState: () => HumanState | undefined
} => {
  let capturedState: HumanState | undefined

  return {
    override: ({ deliveryMode, summary, state }) => {
      capturedState = structuredClone(state) as HumanState
      const finalSummary = input?.summary || summary
      const deliveryMarkdown =
        typeof input?.buildMarkdown === 'function'
          ? input.buildMarkdown({
              deliveryMode,
              summary: finalSummary,
              state: capturedState
            })
          : input?.buildMarkdown ?? `# Test Delivery\n\n${finalSummary}`

      return {
        summary: finalSummary,
        deliveryMarkdown
      }
    },
    getCapturedState: () => capturedState
  }
}

export const summarizeHumanSteps = (events: readonly AiRunEvent[]): string[] =>
  filterAiRunEventsByType(events, 'human_step').map((event) => {
    const stage = event.stage || 'unknown'
    return `${stage}:${event.action}`
  })
