import { ChatOpenAI } from '@langchain/openai'
import type { LLMConfig } from '../../types/store'
import { normalizeOpenAIBaseUrl } from '../../../shared/llmBaseUrl'

export type ChatModelFactoryOptions = {
  temperature?: number
  maxRetries?: number
  timeout?: number
}

export const createChatModel = (cfg: LLMConfig, opts?: ChatModelFactoryOptions) => {
  return new ChatOpenAI({
    model: cfg.model_name,
    apiKey: cfg.api_key,
    temperature: opts?.temperature ?? 0.2,
    maxRetries: opts?.maxRetries ?? 2,
    timeout: opts?.timeout,
    configuration: {
      baseURL: normalizeOpenAIBaseUrl(cfg.base_url)
    }
  })
}
