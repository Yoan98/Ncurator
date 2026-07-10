import fs from 'node:fs/promises'
import path from 'node:path'
import { HumanMessage } from '@langchain/core/messages'
import { tool } from '@langchain/core/tools'
import type { IpcJsonObject } from '../../../../../../shared/types'
import { AI_LLM_CALL_TIMEOUT_MS } from '../../../constants'
import { createChatModel } from '../../../../llm/chatModel'
import { withToolLifecycle } from '../utils/lifecycle'
import { createToolEventEmitter } from '../utils/toolEvents'
import type { ToolFamilyDefinition } from '../types'
import { LLM_RECOGNIZE_TOOL_SPEC } from './toolSpecs'

type VisionRunnable = {
  invoke: (input: HumanMessage[]) => Promise<{ content: unknown }>
}

type LlmRecognizeProtocolResult = {
  supports_image_recognition: boolean
  result: string
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

const buildLlmRecognizeInstruction = (instruction: string): string =>
  [
    '你是图像识别工具的执行模型。你必须只返回一个 JSON 对象，不要返回 Markdown、代码块或额外解释。',
    'JSON 结构必须严格为：{"supports_image_recognition": boolean, "result": string}。',
    '如果你能实际读取随消息提供的图片像素，则 supports_image_recognition 返回 true，result 返回按用户要求得到的图片识别结果。',
    '如果你不能实际读取图片像素，或当前模型不支持图像识别，则 supports_image_recognition 返回 false，result 返回空字符串。',
    '不要把不支持图像识别解释成用户没有上传图片。',
    `用户的图片识别要求：${instruction}`
  ].join('\n')

const isPathInsideWorkspace = (input: {
  workspaceRootPath: string
  targetPath: string
}): boolean => {
  const relativePath = path.relative(input.workspaceRootPath, input.targetPath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

const getMimeType = (sourcePath: string): string => {
  const lowerPath = sourcePath.toLowerCase()
  if (lowerPath.endsWith('.png')) return 'image/png'
  if (lowerPath.endsWith('.webp')) return 'image/webp'
  if (lowerPath.endsWith('.gif')) return 'image/gif'
  if (lowerPath.endsWith('.bmp')) return 'image/bmp'
  return 'image/jpeg'
}

export const imageRecognitionToolFamily: ToolFamilyDefinition = {
  familyId: 'image-recognition',
  buildTools: ({ ctx, runId, taskId }) => {
    const toolEvents = createToolEventEmitter({
      ctx,
      runId,
      taskId
    })

    const llmRecognize = tool(
      async (args) =>
        await withToolLifecycle({
          emitter: toolEvents,
          toolName: LLM_RECOGNIZE_TOOL_SPEC.name,
          args: args as IpcJsonObject,
          execute: async (session) => {
            ctx.checkCancelled()
            const sourcePath = path.resolve(String(args.path || '').trim())
            const instruction = String(args.instruction || '').trim()
            if (!sourcePath || !instruction) {
              const payload = { error: 'path 和 instruction 不能为空' }
              session.fail(payload.error, undefined, {
                toolName: LLM_RECOGNIZE_TOOL_SPEC.name,
                ok: false,
                data: payload
              })
              return payload
            }
            if (
              !ctx.workspace?.rootPath ||
              !isPathInsideWorkspace({
                workspaceRootPath: ctx.workspace.rootPath,
                targetPath: sourcePath
              })
            ) {
              const payload = { error: '图片路径必须位于当前工作区内' }
              session.fail(payload.error, undefined, {
                toolName: LLM_RECOGNIZE_TOOL_SPEC.name,
                ok: false,
                data: payload
              })
              return payload
            }

            try {
              const config = await ctx.getVisionLlmConfig()
              const mimeType = getMimeType(sourcePath)
              const base64 = (await fs.readFile(sourcePath)).toString('base64')
              const model = createChatModel(config, {
                temperature: 0.1,
                streaming: false,
                timeout: AI_LLM_CALL_TIMEOUT_MS
              }) as VisionRunnable
              const result = await model.invoke([
                new HumanMessage({
                  content: [
                    {
                      type: 'text',
                      text: buildLlmRecognizeInstruction(instruction)
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
              if (!protocolResult) {
                const payload = { error: '模型没有按图像识别协议返回结果' }
                session.fail(payload.error, undefined, {
                  toolName: LLM_RECOGNIZE_TOOL_SPEC.name,
                  ok: false,
                  data: payload
                })
                return payload
              }
              if (!protocolResult.supports_image_recognition) {
                const payload = {
                  error: `当前模型 ${config.model_name} 不支持图像识别，请提示用户切换支持图片输入的模型后再试`
                }
                session.fail(payload.error, undefined, {
                  toolName: LLM_RECOGNIZE_TOOL_SPEC.name,
                  ok: false,
                  data: payload
                })
                return payload
              }
              if (!protocolResult.result) {
                const payload = { error: '模型没有返回可用的图像识别结果' }
                session.fail(payload.error, undefined, {
                  toolName: LLM_RECOGNIZE_TOOL_SPEC.name,
                  ok: false,
                  data: payload
                })
                return payload
              }
              session.succeed(undefined, {
                toolName: LLM_RECOGNIZE_TOOL_SPEC.name,
                ok: true,
                data: protocolResult.result
              })
              return protocolResult.result
            } catch (error) {
              const payload = {
                error: error instanceof Error ? error.message || '图像识别失败' : String(error)
              }
              session.fail(payload.error, undefined, {
                toolName: LLM_RECOGNIZE_TOOL_SPEC.name,
                ok: false,
                data: payload
              })
              return payload
            }
          }
        }),
      {
        name: LLM_RECOGNIZE_TOOL_SPEC.name,
        description: LLM_RECOGNIZE_TOOL_SPEC.promptSpec.description,
        schema: LLM_RECOGNIZE_TOOL_SPEC.inputSchema
      }
    )

    return [llmRecognize]
  }
}
