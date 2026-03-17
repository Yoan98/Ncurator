import OpenAI from 'openai'
import type { ChatMessage, LLMConfig } from '../../../shared/types'
import { normalizeOpenAIBaseUrl } from '../../../shared/llmBaseUrl'

export type { ChatMessage, LLMConfig }

// Helper to get active config asynchronously
export const getActiveConfig = async (): Promise<LLMConfig | null> => {
  try {
    const configs = await window.api.llmConfigList()
    return configs.find((c) => c.is_active) || null
  } catch (e) {
    console.error('Failed to load LLM configs', e)
    return null
  }
}

export const streamCompletion = async (
  messages: ChatMessage[],
  config: LLMConfig,
  onChunk: (content: string) => void,
  onError: (error: Error) => void,
  onFinish: () => void
): Promise<void> => {
  try {
    const baseURL = normalizeOpenAIBaseUrl(config.base_url)

    const client = new OpenAI({
      baseURL,
      apiKey: config.api_key,
      dangerouslyAllowBrowser: true
    })

    const stream = await client.chat.completions.create({
      model: config.model_name,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content
      })) as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      stream: true
    })

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || ''
      if (content) {
        onChunk(content)
      }
    }

    onFinish()
  } catch (error) {
    console.error('LLM Service Error:', error)
    onError(error instanceof Error ? error : new Error(String(error)))
  }
}
