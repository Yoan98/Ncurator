import { createHash } from 'node:crypto'
import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import { convertToOpenAITool } from '@langchain/core/utils/function_calling'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type {
  AiLlmRequestWire,
  AiLlmRequestWireDiff,
  AiLlmRequestWireMessage,
  AiLlmRequestWireTool,
  AiLlmRequestWireToolCall,
  JsonValue
} from '../../../../shared/types'
import { serializeMessageContentForTelemetry } from '../structuredOutput'

const PREVIEW_CHARS = 240

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const hashText = (value: string): string => createHash('sha256').update(value).digest('hex')

const toJsonValue = (value: unknown): JsonValue => {
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue
  } catch {
    return null
  }
}

const preview = (value: string): string =>
  value.length <= PREVIEW_CHARS ? value : `${value.slice(0, PREVIEW_CHARS)}…`

const readProviderToolDefinition = (tool: StructuredToolInterface): AiLlmRequestWireTool | undefined => {
  if (!isRecord(tool.extras)) return undefined
  const definition = tool.extras.providerToolDefinition
  if (!isRecord(definition)) return undefined
  const fn = definition.function
  if (!isRecord(fn)) return undefined
  const name = String(fn.name || tool.name || '').trim()
  if (!name) return undefined
  return {
    name,
    description: String(fn.description || tool.description || ''),
    parameters: toJsonValue(fn.parameters)
  }
}

const serializeBoundTool = (tool: StructuredToolInterface): AiLlmRequestWireTool => {
  const fromExtras = readProviderToolDefinition(tool)
  if (fromExtras) return fromExtras
  const converted = convertToOpenAITool(tool)
  const fn = isRecord(converted) && isRecord(converted.function) ? converted.function : undefined
  return {
    name: String(fn?.name || tool.name || '').trim(),
    description: String(fn?.description || tool.description || ''),
    parameters: toJsonValue(fn?.parameters)
  }
}

const serializeToolCalls = (message: AIMessage): AiLlmRequestWireToolCall[] | undefined => {
  const calls = message.tool_calls
  if (!Array.isArray(calls) || calls.length === 0) return undefined
  return calls.map((call) => ({
    id: String(call.id || ''),
    name: String(call.name || ''),
    arguments: JSON.stringify(call.args ?? {})
  }))
}

const serializeMessage = (message: BaseMessage): AiLlmRequestWireMessage => {
  const wire: AiLlmRequestWireMessage = {
    role: message.getType(),
    content: serializeMessageContentForTelemetry(message.content)
  }
  if (AIMessage.isInstance(message)) {
    const toolCalls = serializeToolCalls(message)
    if (toolCalls) wire.toolCalls = toolCalls
    return wire
  }
  if (ToolMessage.isInstance(message)) {
    wire.toolCallId = message.tool_call_id
  }
  return wire
}

export const serializeChatToolsRequestWire = (input: {
  messages: readonly BaseMessage[]
  tools: readonly StructuredToolInterface[]
}): AiLlmRequestWire => {
  const messages = input.messages.map(serializeMessage)
  const tools = input.tools.map(serializeBoundTool)
  return {
    messages,
    tools,
    messagesHash: hashText(JSON.stringify(messages)),
    toolsHash: hashText(JSON.stringify(tools))
  }
}

const diffStrings = (
  path: string,
  left: string,
  right: string
): AiLlmRequestWireDiff => ({
  equal: false,
  firstPath: path,
  leftPreview: preview(left),
  rightPreview: preview(right),
  toolsHashEqual: false,
  messagesHashEqual: false
})

export const diffChatToolsRequestWire = (
  left: AiLlmRequestWire | undefined,
  right: AiLlmRequestWire | undefined
): AiLlmRequestWireDiff => {
  if (!left || !right) {
    return {
      equal: false,
      firstPath: left ? 'right.requestWire' : 'left.requestWire',
      leftPreview: left ? 'present' : 'missing',
      rightPreview: right ? 'present' : 'missing',
      toolsHashEqual: false,
      messagesHashEqual: false
    }
  }

  const toolsHashEqual = left.toolsHash === right.toolsHash
  const messagesHashEqual = left.messagesHash === right.messagesHash
  if (toolsHashEqual && messagesHashEqual) {
    return {
      equal: true,
      firstPath: '',
      leftPreview: '',
      rightPreview: '',
      toolsHashEqual: true,
      messagesHashEqual: true
    }
  }

  const toolCount = Math.max(left.tools.length, right.tools.length)
  for (let index = 0; index < toolCount; index += 1) {
    const leftTool = left.tools[index]
    const rightTool = right.tools[index]
    if (!leftTool || !rightTool) {
      return {
        ...diffStrings(`tools[${index}]`, leftTool ? 'present' : 'missing', rightTool ? 'present' : 'missing'),
        toolsHashEqual,
        messagesHashEqual
      }
    }
    const leftJson = JSON.stringify(leftTool)
    const rightJson = JSON.stringify(rightTool)
    if (leftJson !== rightJson) {
      const field =
        leftTool.name !== rightTool.name
          ? 'name'
          : leftTool.description !== rightTool.description
            ? 'description'
            : 'parameters'
      return {
        ...diffStrings(`tools[${index}].${field}`, leftJson, rightJson),
        toolsHashEqual,
        messagesHashEqual,
        firstDifferingToolIndex: index
      }
    }
  }

  const messageCount = Math.max(left.messages.length, right.messages.length)
  for (let index = 0; index < messageCount; index += 1) {
    const leftMessage = left.messages[index]
    const rightMessage = right.messages[index]
    if (!leftMessage || !rightMessage) {
      return {
        ...diffStrings(
          `messages[${index}]`,
          leftMessage ? 'present' : 'missing',
          rightMessage ? 'present' : 'missing'
        ),
        toolsHashEqual,
        messagesHashEqual,
        firstDifferingMessageIndex: index
      }
    }
    if (leftMessage.role !== rightMessage.role) {
      return {
        ...diffStrings(`messages[${index}].role`, leftMessage.role, rightMessage.role),
        toolsHashEqual,
        messagesHashEqual,
        firstDifferingMessageIndex: index
      }
    }
    if (leftMessage.content !== rightMessage.content) {
      return {
        ...diffStrings(`messages[${index}].content`, leftMessage.content, rightMessage.content),
        toolsHashEqual,
        messagesHashEqual,
        firstDifferingMessageIndex: index
      }
    }
    if ((leftMessage.toolCallId || '') !== (rightMessage.toolCallId || '')) {
      return {
        ...diffStrings(
          `messages[${index}].toolCallId`,
          leftMessage.toolCallId || '',
          rightMessage.toolCallId || ''
        ),
        toolsHashEqual,
        messagesHashEqual,
        firstDifferingMessageIndex: index
      }
    }
    const leftCalls = JSON.stringify(leftMessage.toolCalls || [])
    const rightCalls = JSON.stringify(rightMessage.toolCalls || [])
    if (leftCalls !== rightCalls) {
      return {
        ...diffStrings(`messages[${index}].toolCalls`, leftCalls, rightCalls),
        toolsHashEqual,
        messagesHashEqual,
        firstDifferingMessageIndex: index
      }
    }
  }

  return {
    equal: false,
    firstPath: 'unknown',
    leftPreview: left.toolsHash,
    rightPreview: right.toolsHash,
    toolsHashEqual,
    messagesHashEqual
  }
}
