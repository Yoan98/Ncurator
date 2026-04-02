import type {
  BrainMemoryOp,
  HumanState,
  LastBrainDecision,
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

export const summarizeHumanSteps = (events: readonly AiRunEvent[]): string[] =>
  filterAiRunEventsByType(events, 'human_step').map((event) => {
    const stage = event.stage || 'unknown'
    return `${stage}:${event.action}`
  })

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
  readyToDeliver: false,
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
  readyToDeliver: false,
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
  readyToDeliver: true,
  nextAction: {
    action: 'mouth'
  }
})

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

export const readLatestToolResultDataFromEvents = <TValue>(
  events: readonly AiRunEvent[],
  toolName: string
): TValue => {
  const event = filterToolCallResultEventsByName(events, toolName).at(-1)
  if (!event?.result?.data) {
    throw new Error(`tool result data missing for ${toolName}`)
  }
  return event.result.data as TValue
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
