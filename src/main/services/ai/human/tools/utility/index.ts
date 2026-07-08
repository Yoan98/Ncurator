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
import { LLM_RECOGNIZE_TOOL_SPEC, WAIT_TIME_TOOL_SPEC } from './toolSpecs'

const sleep = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

type VisionRunnable = {
  invoke: (input: HumanMessage[]) => Promise<{ content: unknown }>
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

const isPathInsideWorkspace = (input: { workspaceRootPath: string; targetPath: string }): boolean => {
  const relativePath = path.relative(input.workspaceRootPath, input.targetPath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

export const utilityToolFamily: ToolFamilyDefinition = {
  familyId: 'utility',
  buildTools: ({ ctx, runId, taskId }) => {
    const toolEvents = createToolEventEmitter({
      ctx,
      runId,
      taskId
    })

    const waitTime = tool(
      async (args) =>
        await withToolLifecycle({
          emitter: toolEvents,
          toolName: WAIT_TIME_TOOL_SPEC.name,
          args: args as IpcJsonObject,
          execute: async (session) => {
            ctx.checkCancelled()
            const seconds = Math.max(0, Math.min(60, Number(args.seconds || 0)))
            const waitMs = Math.round(seconds * 1000)
            const startedAt = Date.now()
            await sleep(waitMs)
            const payload = {
              waitedMs: Date.now() - startedAt
            }
            session.succeed(undefined, {
              toolName: WAIT_TIME_TOOL_SPEC.name,
              ok: true,
              data: payload
            })
            return payload
          }
        }),
      {
        name: WAIT_TIME_TOOL_SPEC.name,
        description: WAIT_TIME_TOOL_SPEC.promptSpec.description,
        schema: WAIT_TIME_TOOL_SPEC.inputSchema
      }
    )

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
            if (!ctx.workspace?.rootPath || !isPathInsideWorkspace({
              workspaceRootPath: ctx.workspace.rootPath,
              targetPath: sourcePath
            })) {
              const payload = { error: '图片路径必须位于当前工作区内' }
              session.fail(payload.error, undefined, {
                toolName: LLM_RECOGNIZE_TOOL_SPEC.name,
                ok: false,
                data: payload
              })
              return payload
            }

            try {
              const config = await ctx.getLlmConfig()
              const mimeType = sourcePath.endsWith('.png')
                ? 'image/png'
                : sourcePath.endsWith('.webp')
                  ? 'image/webp'
                  : sourcePath.endsWith('.gif')
                    ? 'image/gif'
                    : sourcePath.endsWith('.bmp')
                      ? 'image/bmp'
                      : 'image/jpeg'
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
                      text: instruction
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
              if (!text) {
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
                data: text
              })
              return text
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

    return [waitTime, llmRecognize]
  }
}
