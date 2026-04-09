import type {
  HumanDecision,
  HumanState,
  HumanStableMemoryPatch,
  RuntimeSkillId
} from '../../../src/main/services/ai/human/types'
import type { AiRunEvent, JsonArray, JsonObject, JsonValue } from '../../../src/shared/types'

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
  updatedStableMemory?: HumanStableMemoryPatch
}): HumanDecision => ({
  updatedStableMemory: input.updatedStableMemory,
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
  updatedStableMemory?: HumanStableMemoryPatch
  mode?: 'parallel' | 'serial'
}): HumanDecision => ({
  updatedStableMemory: input.updatedStableMemory,
  decision: buildDecisionMetadata(input),
  readyToDeliver: false,
  nextAction: {
    action: 'hand',
    toolUsePlan: {
      mode: input.mode || 'serial',
      calls: [
        {
          toolName: input.toolName,
          args: input.args
        }
      ]
    }
  }
})

export const buildCompleteTaskDecision = (input: {
  summary: string
  reason: string
  expectedOutcome: string
  updatedStableMemory?: HumanStableMemoryPatch
}): HumanDecision => ({
  updatedStableMemory: input.updatedStableMemory,
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

export const collectStartedToolInputs = (
  events: readonly AiRunEvent[],
  toolName: string
): JsonObject[] => filterToolCallStartedEventsByName(events, toolName).map((event) => event.input)

export const collectStartedToolStringArgs = (
  events: readonly AiRunEvent[],
  toolName: string,
  argName: string
): string[] =>
  collectStartedToolInputs(events, toolName)
    .map((input) => input[argName])
    .filter((value): value is string => typeof value === 'string')

export const hasKbToolCall = (events: readonly AiRunEvent[]): boolean =>
  filterAiRunEventsByType(events, 'tool_call_result').some((event) => event.toolName.startsWith('kb_'))

const isJsonObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isJsonArray = (value: JsonValue | undefined): value is JsonArray => Array.isArray(value)

const collectDocxBlockKindsFromValue = (
  value: JsonValue | undefined,
  kinds: Set<'paragraph' | 'table'>
): void => {
  if (isJsonArray(value)) {
    value.forEach((item) => collectDocxBlockKindsFromValue(item, kinds))
    return
  }

  if (!isJsonObject(value)) {
    return
  }

  const kind = value.kind
  if (kind === 'paragraph' || kind === 'table') {
    kinds.add(kind)
  }

  collectDocxBlockKindsFromValue(value.content, kinds)
  collectDocxBlockKindsFromValue(value.ops, kinds)
  collectDocxBlockKindsFromValue(value.rows, kinds)
}

export const collectDocxApplyOpsContentKinds = (
  events: readonly AiRunEvent[]
): Array<'paragraph' | 'table'> => {
  const kinds = new Set<'paragraph' | 'table'>()
  collectStartedToolInputs(events, 'docx_apply_ops').forEach((input) => {
    collectDocxBlockKindsFromValue(input, kinds)
  })
  return [...kinds]
}

const isStructuredOutputEmptyResponseError = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('structured_output_empty_response')

export const runWithStructuredOutputRetry = async (
  action: () => Promise<void>,
  maxAttempts = 2
): Promise<void> => {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await action()
      return
    } catch (error) {
      lastError = error
      if (!isStructuredOutputEmptyResponseError(error) || attempt >= maxAttempts) {
        throw error
      }
    }
  }
  throw lastError
}

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
  const result = state.execution.lastToolResults?.[0]
  if (!result) {
    throw new Error('execution.lastToolResults is empty')
  }
  if (toolName && result.toolName !== toolName) {
    throw new Error(`expected tool result ${toolName}, received ${result.toolName}`)
  }
  return result.data as TValue
}
