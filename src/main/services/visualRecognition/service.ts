import fs from 'node:fs/promises'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { AI_LLM_CALL_TIMEOUT_MS } from '../ai/constants'
import { createChatModel } from '../llm/chatModel'
import type { AiRunContext } from '../ai/types'
import type { LlmRuntimeConfig } from '../../../shared/types'
import { mapLimit } from '../../utils/concurrency'
import {
  buildVisualRecognitionUserInstruction,
  VISUAL_RECOGNITION_SYSTEM_PROMPT
} from '../ai/prompts/visualRecognition'

type VisionRunnable = {
  invoke: (input: Array<SystemMessage | HumanMessage>) => Promise<{ content: unknown }>
}

const VISUAL_RECOGNITION_CONCURRENCY = 3

type LlmRecognizeProtocolResult = {
  supports_image_recognition: boolean
  result: string
}

export type VisualRecognitionImage = {
  index: number
  path: string
  mimeType?: string
}

export type VisualRecognitionRequest = {
  index: number
  instruction: string
}

export type VisualRecognitionResult =
  | {
      index: number
      text: string
    }
  | {
      index: number
      error: string
    }

export type VisualRecognitionSingleResult =
  | {
      text: string
    }
  | {
      error: string
    }

export type VisualRecognitionService = {
  recognizeImage: (input: {
    path: string
    instruction: string
    mimeType?: string
  }) => Promise<VisualRecognitionSingleResult>
  recognizeImages: (input: {
    images: VisualRecognitionImage[]
    requests: VisualRecognitionRequest[]
  }) => Promise<VisualRecognitionResult[]>
}

const extractMessageText = (content: unknown): string => {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (!part || typeof part !== 'object') return ''
      const record = part as { text?: unknown; content?: unknown }
      return typeof record.text === 'string'
        ? record.text
        : typeof record.content === 'string'
          ? record.content
          : ''
    })
    .join('')
    .trim()
}

const extractJsonObjectText = (text: string): string => {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed

  const fencedMatch = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed)
  if (fencedMatch?.[1]) {
    const fenced = fencedMatch[1].trim()
    if (fenced.startsWith('{') && fenced.endsWith('}')) return fenced
  }

  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1)
  }

  return trimmed
}

const parseLlmRecognizeProtocolResult = (text: string): LlmRecognizeProtocolResult | null => {
  try {
    const parsed = JSON.parse(extractJsonObjectText(text)) as {
      supports_image_recognition?: unknown
      result?: unknown
    }
    if (typeof parsed.supports_image_recognition !== 'boolean') return null
    return {
      supports_image_recognition: parsed.supports_image_recognition,
      result: typeof parsed.result === 'string' ? parsed.result.trim() : ''
    }
  } catch {
    return null
  }
}

export const getImageMimeType = (sourcePath: string): string => {
  const lowerPath = sourcePath.toLowerCase()
  if (lowerPath.endsWith('.png')) return 'image/png'
  if (lowerPath.endsWith('.webp')) return 'image/webp'
  if (lowerPath.endsWith('.gif')) return 'image/gif'
  if (lowerPath.endsWith('.bmp')) return 'image/bmp'
  return 'image/jpeg'
}

const recognizeImageWithModel = async (input: {
  model: VisionRunnable
  config: LlmRuntimeConfig
  path: string
  instruction: string
  mimeType?: string
}): Promise<VisualRecognitionSingleResult> => {
  try {
    const mimeType = input.mimeType || getImageMimeType(input.path)
    const base64 = (await fs.readFile(input.path)).toString('base64')
    const result = await input.model.invoke([
      new SystemMessage(VISUAL_RECOGNITION_SYSTEM_PROMPT),
      new HumanMessage({
        content: [
          {
            type: 'text',
            text: buildVisualRecognitionUserInstruction(input.instruction)
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64}`
            }
          }
        ]
      })
    ])
    const text = extractMessageText(result.content)
    const protocolResult = text ? parseLlmRecognizeProtocolResult(text) : null
    if (!protocolResult) return { error: '模型没有按图像识别协议返回结果' }
    if (!protocolResult.supports_image_recognition) {
      return {
        error: `当前模型 ${input.config.model_name} 不支持图像识别，请提示用户切换支持图片输入的模型后再试`
      }
    }
    if (!protocolResult.result) return { error: '模型没有返回可用的图像识别结果' }
    return { text: protocolResult.result }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message || '图像识别失败' : String(error)
    }
  }
}

export const createVisualRecognitionService = (ctx: AiRunContext): VisualRecognitionService => {
  const createModel = async (): Promise<{ config: LlmRuntimeConfig; model: VisionRunnable }> => {
    const config = await ctx.getVisionLlmConfig()
    const model = createChatModel(config, {
      temperature: 0.1,
      streaming: false,
      timeout: AI_LLM_CALL_TIMEOUT_MS
    }) as VisionRunnable
    return { config, model }
  }

  const recognizeImage: VisualRecognitionService['recognizeImage'] = async (input) => {
    ctx.checkCancelled()
    const { config, model } = await createModel()
    return await recognizeImageWithModel({
      model,
      config,
      path: input.path,
      instruction: input.instruction,
      mimeType: input.mimeType
    })
  }

  const recognizeImages: VisualRecognitionService['recognizeImages'] = async (input) => {
    if (input.requests.length === 0) return []
    let modelContext: { config: LlmRuntimeConfig; model: VisionRunnable }
    try {
      modelContext = await createModel()
    } catch (error) {
      const message = error instanceof Error ? error.message || '图像识别失败' : String(error)
      return input.requests.map((request) => ({ index: request.index, error: message }))
    }

    const imageByIndex = new Map<number, VisualRecognitionImage>()
    input.images.forEach((image) => {
      if (!imageByIndex.has(image.index)) imageByIndex.set(image.index, image)
    })

    return await mapLimit(input.requests, VISUAL_RECOGNITION_CONCURRENCY, async (request) => {
      ctx.checkCancelled()
      const image = imageByIndex.get(request.index)
      if (!image) {
        return {
          index: request.index,
          error: `找不到 index=${String(request.index)} 的图片`
        }
      }
      const result = await recognizeImageWithModel({
        ...modelContext,
        path: image.path,
        instruction: request.instruction,
        mimeType: image.mimeType
      })
      return { index: request.index, ...result }
    })
  }

  return {
    recognizeImage,
    recognizeImages
  }
}
