import { LLMClient, toJsonSchema } from '@browserbasehq/stagehand'
import type {
  ChatMessage,
  CreateChatCompletionOptions,
  LLMParsedResponse,
  LLMResponse,
  LLMUsage
} from '@browserbasehq/stagehand'
import type { BaseMessageLike, MessageContent } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { LlmRuntimeConfig } from '../../../shared/types'
import { createChatModel } from './chatModel'

type StagehandResponseModel = NonNullable<CreateChatCompletionOptions['options']['response_model']>

const contentToLangChainContent = (content: ChatMessage['content']): MessageContent => {
  if (typeof content === 'string') return content
  return content.map((item) => {
    if ('image_url' in item && item.image_url?.url) {
      return {
        type: 'image_url',
        image_url: {
          url: item.image_url.url
        }
      }
    }
    return {
      type: 'text',
      text: item.text || ''
    }
  })
}

const toLangChainMessages = (messages: ChatMessage[]): BaseMessageLike[] =>
  messages.map((message) => ({
    role: message.role,
    content: contentToLangChainContent(message.content)
  }))

const extractTextContent = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content || '')
  return content
    .map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object' && 'text' in item && typeof item.text === 'string') {
        return item.text
      }
      return ''
    })
    .join('')
}

const extractUsage = (message: unknown): LLMUsage => {
  const usage =
    message && typeof message === 'object' && 'usage_metadata' in message
      ? (message as { usage_metadata?: Record<string, unknown> }).usage_metadata
      : undefined
  const promptTokens = typeof usage?.input_tokens === 'number' ? usage.input_tokens : 0
  const completionTokens = typeof usage?.output_tokens === 'number' ? usage.output_tokens : 0
  const totalTokens =
    typeof usage?.total_tokens === 'number' ? usage.total_tokens : promptTokens + completionTokens
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens
  }
}

const parseJsonObject = (value: string): unknown => {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('No content in response')
  try {
    return JSON.parse(trimmed)
  } catch {
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (match?.[1]) return JSON.parse(match[1].trim())
    throw new Error('Failed to parse model response as JSON')
  }
}

const validateResponseModel = <T>(responseModel: StagehandResponseModel, value: unknown): T => {
  const schema = responseModel.schema as {
    parse?: (input: unknown) => T
    safeParse?: (input: unknown) => { success: true; data: T } | { success: false; error: unknown }
  }
  if (typeof schema.safeParse === 'function') {
    const parsed = schema.safeParse(value)
    if (!parsed.success) throw new Error(String(parsed.error || 'Response failed schema validation'))
    return parsed.data
  }
  if (typeof schema.parse === 'function') return schema.parse(value)
  return value as T
}

const createSchemaInstruction = (responseModel: StagehandResponseModel): BaseMessageLike => ({
  role: 'user',
  content: `Respond with valid JSON matching this schema named ${responseModel.name}:\n${JSON.stringify(
    toJsonSchema(responseModel.schema),
    null,
    2
  )}\n\nDo not include markdown fences or any extra text. Only return the JSON object itself.`
})

const createOpenAIShape = (input: {
  modelName: string
  content: string
  usage: LLMUsage
}): LLMResponse => ({
  id: '',
  object: 'chat.completion',
  created: Math.floor(Date.now() / 1000),
  model: input.modelName,
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: input.content,
        tool_calls: []
      },
      finish_reason: 'stop'
    }
  ],
  usage: input.usage
})

export class StagehandLangChainClient extends LLMClient {
  public type = 'openai' as const
  private readonly model: BaseChatModel

  public constructor(config: LlmRuntimeConfig) {
    super(config.model_name)
    this.model = createChatModel(config, {
      temperature: 0,
      transport: 'completions',
      streaming: false
    }) as BaseChatModel
  }

  public async createChatCompletion<T>(
    input: CreateChatCompletionOptions
  ): Promise<T | LLMParsedResponse<T>> {
    const responseModel = input.options.response_model
    const messages = toLangChainMessages(input.options.messages)
    if (responseModel) messages.push(createSchemaInstruction(responseModel))

    const response = await this.model.invoke(messages)
    const content = extractTextContent(response.content)
    const usage = extractUsage(response)

    if (responseModel) {
      const parsed = validateResponseModel<T>(responseModel, parseJsonObject(content))
      return {
        data: parsed,
        usage
      }
    }

    return createOpenAIShape({
      modelName: this.modelName,
      content,
      usage
    }) as T
  }
}
