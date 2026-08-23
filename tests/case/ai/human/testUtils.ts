import type {
  HumanThoughtDecision,
  HumanThought,
  RuntimeSkillId
} from '../../../../src/main/services/ai/human/types'
import type {
  AiArtifactRef,
  AiRunEvent,
  JsonArray,
  JsonObject,
  JsonValue
} from '../../../../src/shared/types'

export const filterAiRunEventsByType = <TType extends AiRunEvent['type']>(
  events: readonly AiRunEvent[],
  type: TType
): Extract<AiRunEvent, { type: TType }>[] =>
  events.filter((event): event is Extract<AiRunEvent, { type: TType }> => event.type === type)

export const summarizeHumanSteps = (events: readonly AiRunEvent[]): string[] =>
  filterAiRunEventsByType(events, 'human_step').map((event) => {
    const stage = event.stage || 'unknown'
    return `${stage}:${event.action}`
  })

const buildThoughtMetadata = (
  input: { summary: string } & Partial<HumanThought>
): HumanThought => ({
  next: input.next || input.summary,
  todolist: input.todolist
})

export const buildLearnSkillsDecision = (
  input: {
    skillIds: RuntimeSkillId[]
    summary: string
  } & Partial<HumanThought>
): HumanThoughtDecision => ({
  thought: buildThoughtMetadata(input),
  nextAction: {
    action: 'learning',
    wantLearnSkillIds: input.skillIds
  }
})

export const buildToolDecision = (
  input: {
    toolName: string
    args: JsonObject
    summary: string
  } & Partial<HumanThought>
): HumanThoughtDecision => ({
  thought: buildThoughtMetadata(input),
  nextAction: {
    action: 'hand',
    calls: [
      {
        toolName: input.toolName,
        args:
          input.toolName === 'terminal_run' &&
          typeof input.args.command === 'string' &&
          typeof input.args.commandExplanation !== 'string'
            ? {
                ...input.args,
                commandExplanation: `执行测试命令：${input.args.command}`
              }
            : input.args
      }
    ]
  }
})

export const buildCompleteTaskDecision = (
  input: {
    summary: string
  } & Partial<HumanThought>
): HumanThoughtDecision => ({
  thought: buildThoughtMetadata(input),
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
  filterAiRunEventsByType(events, 'tool_call_started').filter(
    (event) => event.toolName === toolName
  )

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

export const isDocxEditCreateInput = (input: JsonObject): boolean =>
  Array.isArray(input.actions) &&
  input.actions.length > 0 &&
  input.actions.every(
    (action) =>
      action &&
      typeof action === 'object' &&
      !Array.isArray(action) &&
      (action as JsonObject).type === 'insert_blocks'
  )

export const isDocxEditWriteInput = (input: JsonObject): boolean =>
  Array.isArray(input.actions) &&
  input.actions.some(
    (action) =>
      action &&
      typeof action === 'object' &&
      !Array.isArray(action) &&
      (action as JsonObject).type !== 'insert_blocks'
  )

export const collectStartedDocxEditSourcePaths = (
  events: readonly AiRunEvent[],
  predicate: (input: JsonObject) => boolean
): string[] =>
  collectStartedToolInputs(events, 'docx_edit')
    .filter(predicate)
    .map((input) => input.sourcePath)
    .filter((value): value is string => typeof value === 'string')

export const hasKbToolCall = (events: readonly AiRunEvent[]): boolean =>
  filterAiRunEventsByType(events, 'tool_call_result').some((event) =>
    event.toolName.startsWith('kb_')
  )

export const hasDocxApplyArtifact = (artifacts: readonly AiArtifactRef[] | undefined): boolean =>
  Array.isArray(artifacts) &&
  artifacts.some(
    (artifact) =>
      artifact.kind === 'file' &&
      artifact.capability === 'docx' &&
      typeof artifact.applyId === 'string' &&
      artifact.applyId.length > 0
  )

export const countDocxApplyArtifacts = (artifacts: readonly AiArtifactRef[] | undefined): number =>
  Array.isArray(artifacts)
    ? artifacts.filter(
        (artifact) =>
          artifact.kind === 'file' &&
          artifact.capability === 'docx' &&
          typeof artifact.applyId === 'string' &&
          artifact.applyId.length > 0
      ).length
    : 0

export const hasDocxFileArtifact = (artifacts: readonly AiArtifactRef[] | undefined): boolean =>
  Array.isArray(artifacts) &&
  artifacts.some((artifact) => artifact.kind === 'file' && artifact.capability === 'docx')

export const countDocxFileArtifacts = (artifacts: readonly AiArtifactRef[] | undefined): number =>
  Array.isArray(artifacts)
    ? artifacts.filter((artifact) => artifact.kind === 'file' && artifact.capability === 'docx')
        .length
    : 0

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
  const type = value.type
  if (kind === 'paragraph' || kind === 'table') {
    kinds.add(kind)
  }
  if (type === 'paragraph' || type === 'table') {
    kinds.add(type)
  }

  collectDocxBlockKindsFromValue(value.content, kinds)
  collectDocxBlockKindsFromValue(value.ops, kinds)
  collectDocxBlockKindsFromValue(value.rows, kinds)
  collectDocxBlockKindsFromValue(value.blocks, kinds)
}

export const collectDocxApplyOpsContentKinds = (
  events: readonly AiRunEvent[]
): Array<'paragraph' | 'table'> => {
  const kinds = new Set<'paragraph' | 'table'>()
  collectStartedToolInputs(events, 'docx_edit').forEach((input) => {
    if (Array.isArray(input.actions)) {
      input.actions.forEach((action) => {
        if (!action || typeof action !== 'object' || Array.isArray(action)) return
        const actionInput = action as JsonObject
        if (actionInput.type === 'insert_blocks') {
          collectDocxBlockKindsFromValue(actionInput.blocks, kinds)
        }
        if (actionInput.type === 'replace_block') {
          collectDocxBlockKindsFromValue(actionInput.block, kinds)
        }
      })
    }
    collectDocxBlockKindsFromValue(input, kinds)
  })
  return [...kinds]
}

const isPromptJsonEmptyResponseError = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('prompt_json_empty_response')

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
      if (!isPromptJsonEmptyResponseError(error) || attempt >= maxAttempts) {
        throw error
      }
    }
  }
  throw lastError
}

export const readToolCallResultData = <TValue extends JsonValue>(
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
  if (event.result?.data === undefined) {
    throw new Error(`tool_call_result data missing for ${toolName} at index ${String(index)}`)
  }
  return event.result.data as TValue
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

export const collectToolErrorMessages = (
  events: readonly AiRunEvent[],
  toolName?: string
): string[] =>
  filterAiRunEventsByType(events, 'tool_call_result')
    .filter((event) => (toolName ? event.toolName === toolName : true))
    .map((event) => {
      const data = event.result?.data
      return data && typeof data === 'object' && !Array.isArray(data) ? data.error : undefined
    })
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
