import type { BrowserUseAction, BrowserUseMode, BrowserUseResult } from '../ai/types'
import type { LlmRuntimeConfig } from '../../../shared/types'

export type BrowserPanelBoundsState = {
  x: number
  y: number
  width: number
  height: number
  visible: boolean
}

export type BrowserUseRunInput = {
  action: BrowserUseAction
  instruction: string
  url?: string
  mode: BrowserUseMode
  llmConfig: LlmRuntimeConfig
}

export type BrowserUseRunResult = BrowserUseResult

export type OpenAIChatContentPart =
  | {
      type: 'text'
      text: string
    }
  | {
      type: 'image_url'
      image_url: {
        url: string
      }
    }

export type OpenAIChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | OpenAIChatContentPart[]
}

export type OpenAICompatibleChatCompletionResponse = {
  choices: Array<{
    message: {
      content: string | null
    }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

export type OpenAICompatibleChatClient = {
  chat: {
    completions: {
      create: (
        body: Record<string, string | number | boolean | null | object | Array<object>>
      ) => Promise<OpenAICompatibleChatCompletionResponse>
    }
  }
}
