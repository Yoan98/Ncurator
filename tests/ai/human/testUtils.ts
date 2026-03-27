import type {
  BrainMemoryOp,
  HumanDeliveryMode,
  HumanTaskOutput,
  HumanState,
  LastBrainDecision,
  MouthOutput,
  RuntimeSkillId
} from '../../../src/main/services/ai/human/types'
import type { AiRunEvent, JsonObject, JsonValue } from '../../../src/shared/types'

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

type EventDrivenDecisionStep =
  | LastBrainDecision
  | ((input: { events: readonly AiRunEvent[] }) => LastBrainDecision)

const buildDecisionMetadata = (input: {
  summary: string
  reason: string
  expectedOutcome: string
}) => ({
  summary: input.summary,
  reason: input.reason,
  expectedOutcome: input.expectedOutcome
})

export const buildLearnSkillsDecision = (input: {
  skillIds: RuntimeSkillId[]
  summary: string
  reason: string
  expectedOutcome: string
  memoryOps?: BrainMemoryOp[]
}): LastBrainDecision => ({
  memoryOps: input.memoryOps || [],
  decision: buildDecisionMetadata(input),
  nextAction: {
    action: 'learning',
    wantLearnSkillIds: input.skillIds
  }
})

export const buildToolDecision = (input: {
  toolName: string
  args: JsonObject
  summary: string
  reason: string
  expectedOutcome: string
  memoryOps?: BrainMemoryOp[]
}): LastBrainDecision => ({
  memoryOps: input.memoryOps || [],
  decision: buildDecisionMetadata(input),
  nextAction: {
    action: 'hand',
    parallelCallToolParam: [
      {
        toolName: input.toolName,
        args: input.args
      }
    ]
  }
})

export const buildCompleteTaskDecision = (input: {
  summary: string
  reason: string
  expectedOutcome: string
  memoryOps?: BrainMemoryOp[]
}): LastBrainDecision => ({
  memoryOps: input.memoryOps || [],
  decision: buildDecisionMetadata(input),
  nextAction: {
    action: 'mouth'
  }
})

export const createEventDrivenBrainDecisionResolver = (input: {
  getEvents: () => readonly AiRunEvent[]
  steps: readonly EventDrivenDecisionStep[]
}): (() => LastBrainDecision) => {
  let index = 0

  return () => {
    const current = input.steps[index]
    if (!current) {
      throw new Error(`unexpected brain decision request at step ${index + 1}`)
    }

    index += 1
    return typeof current === 'function'
      ? current({
          events: input.getEvents()
        })
      : current
  }
}

export const filterToolCallResultEventsByName = (
  events: readonly AiRunEvent[],
  toolName: string
): Extract<AiRunEvent, { type: 'tool_call_result' }>[] =>
  filterAiRunEventsByType(events, 'tool_call_result').filter((event) => event.toolName === toolName)

export const filterToolCallStartedEventsByName = (
  events: readonly AiRunEvent[],
  toolName: string
): Extract<AiRunEvent, { type: 'tool_call_started' }>[] =>
  filterAiRunEventsByType(events, 'tool_call_started').filter((event) => event.toolName === toolName)

export const readToolCallResultPreview = <TValue extends JsonValue>(
  events: readonly AiRunEvent[],
  toolName: string,
  index = -1
): TValue => {
  const matches = filterToolCallResultEventsByName(events, toolName)
  const resolvedIndex = index < 0 ? matches.length + index : index
  const event = matches[resolvedIndex]
  if (!event) {
    throw new Error(`tool_call_result not found for ${toolName} at index ${String(index)}`)
  }
  return event.outputPreview as TValue
}

export const readToolCallInput = <TValue extends JsonObject>(
  events: readonly AiRunEvent[],
  toolName: string,
  index = -1
): TValue => {
  const matches = filterToolCallStartedEventsByName(events, toolName)
  const resolvedIndex = index < 0 ? matches.length + index : index
  const event = matches[resolvedIndex]
  if (!event) {
    throw new Error(`tool_call_started not found for ${toolName} at index ${String(index)}`)
  }
  return event.input as TValue
}

export const readSingleToolResultData = <TValue extends JsonValue>(
  state: HumanState,
  toolName?: string
): TValue => {
  const result = state.lastParallelCallToolResults?.[0]
  if (!result) {
    throw new Error('lastParallelCallToolResults is empty')
  }
  if (toolName && result.toolName !== toolName) {
    throw new Error(`expected tool result ${toolName}, received ${result.toolName}`)
  }
  return result.data as TValue
}

export const buildHumanTaskOutputFromState = (state: HumanState): HumanTaskOutput => ({
  taskId: state.task.taskId,
  status: state.result?.status || 'completed',
  summary: state.result?.summary || '任务未产出最终结果。',
  deliveryMarkdown: state.result?.deliveryMarkdown,
  artifacts: state.result?.artifacts
})
