import { describe, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import {
  FREE_MODEL_CATALOG_CACHE_VERSION,
  type FreeModelCatalogEntry
} from '../../../../../src/shared/freeModels'
import { hasEffectiveImageContextInMessageLog } from '../../../../../src/shared/messageLogVisionContext'
import { messagesFromLogEntries } from '../../../../../src/main/services/ai/human/memory/conversationLogMessages'
import { projectMessagesForMainModel } from '../../../../../src/main/services/ai/human/memory/multimodal'
import { getAppRuntime } from '../../../../../src/main/services/app/AppRuntime'
import { createPdfToolHarness } from '../../../../harness/backend/aiToolHarness'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  buildSelectedPdfFixtureReference,
  PDF_READING_FIXTURE_PATH
} from '../../../../harness/backend/aiLiveTestData'
import {
  buildCompleteTaskDecision,
  buildLoadToolsetsDecision,
  filterAiRunEventsByType
} from '../testUtils'

describe('ai human mock-llm backend', () => {
  it('human-read-image-no-vision', async () => {
    await runBackendCase({
      caseId: 'human-read-image-no-vision',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证免费无视觉模型收到读图能力限制后继续完成文字交付。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const originalUserDataPath = process.env.NCURATOR_USER_DATA_PATH
        const userDataPath = path.join(runtime.workspaceRoot, 'user-data')
        const imagePath = path.join(runtime.workspaceRoot, 'source.png')
        const imageBytes = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          'base64'
        )
        const entry: FreeModelCatalogEntry = {
          id: 'test-text-only',
          providerKind: 'openai-compatible',
          modelName: 'test-text-only',
          label: 'Test text only',
          description: '',
          capabilities: ['text'],
          iconUrl: 'https://example.test/icon.png',
          baseUrl: 'https://www.guanzhangai.cn/api/v1/free',
          apiKey: `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 5400 })).toString('base64url')}.signature`
        }
        await fs.mkdir(userDataPath, { recursive: true })
        await fs.writeFile(imagePath, imageBytes)
        const { serviceRoute, locale } = getAppRuntime()
        await fs.writeFile(
          path.join(userDataPath, `${serviceRoute}-${locale}-free-models-catalog.json`),
          JSON.stringify({
            schemaVersion: FREE_MODEL_CATALOG_CACHE_VERSION,
            fetchedAt: Date.now(),
            updatedAt: null,
            models: [entry]
          })
        )
        process.env.NCURATOR_USER_DATA_PATH = userDataPath
        try {
          let followupMessages: BaseMessage[] = []
          const runner = createHumanTestRunner(runtime, {
            mainModel: { configId: `free:${entry.id}`, modelName: entry.modelName },
            chatToolsWrapper: (chatTools) => async (request) => {
              if (request.messages.some((message) => message.getType() === 'tool')) {
                followupMessages = request.messages
              }
              return chatTools(request)
            },
            structuredOutputScript: {
              'human.brain': [
                {
                  output: {
                    nextAction: {
                      action: 'hand',
                      calls: [{ toolName: 'read_image', args: { paths: [imagePath] } }]
                    }
                  }
                },
                {
                  output: buildCompleteTaskDecision({
                    summary: '说明图片能力限制并完成文字部分。',
                    deliveryMarkdown: '当前模型不支持图片理解，可以继续处理文字。'
                  })
                }
              ]
            }
          })
          const output = await runner.run({
            taskId: runtime.taskId,
            userInput: `读取图片 ${imagePath}，如果无法读取请说明限制并继续处理文字。`
          })
          const records = await runner.ctx.loadMessageLog()
          const toolEntry = records.find((record) => record.entry.kind === 'tool')?.entry
          const noImageCache = await fs
            .access(
              path.join(
                userDataPath,
                'partners',
                runner.ctx.partnerId,
                'runtime/assets/read_image-cache'
              )
            )
            .then(
              () => false,
              () => true
            )
          return {
            output,
            events: runtime.eventCollector.snapshot(),
            toolEntry,
            followupToolText: followupMessages
              .filter((message) => message.getType() === 'tool')
              .map((message) => String(message.content))
              .join('\n'),
            imageBlockCount: followupMessages.reduce(
              (count, message) =>
                count +
                (Array.isArray(message.content)
                  ? message.content.filter((block) => block.type === 'image_url').length
                  : 0),
              0
            ),
            hasEffectiveImages: hasEffectiveImageContextInMessageLog(records),
            sourceUnchanged: (await fs.readFile(imagePath)).equals(imageBytes),
            noImageCache
          }
        } finally {
          if (originalUserDataPath === undefined) delete process.env.NCURATOR_USER_DATA_PATH
          else process.env.NCURATOR_USER_DATA_PATH = originalUserDataPath
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.output.status === 'completed' &&
            result.toolEntry?.kind === 'tool' &&
            result.toolEntry.toolName === 'read_image' &&
            !result.toolEntry.ok &&
            !result.toolEntry.images?.length &&
            result.followupToolText.includes('does not support image input') &&
            result.followupToolText.includes('No image content was loaded') &&
            result.followupToolText.includes('Do not retry read_image') &&
            result.imageBlockCount === 0 &&
            !result.hasEffectiveImages &&
            result.sourceUnchanged &&
            result.noImageCache &&
            !result.events.some((event) => event.type === 'run_failed'),
          {
            name: 'no-vision-read-image-error-keeps-graph-running',
            message: '无视觉模型应收到明确能力反馈，不加入图片并继续完成任务。',
            data: {
              status: result.output.status,
              toolFailed: result.toolEntry?.kind === 'tool' && !result.toolEntry.ok,
              followupToolText: result.followupToolText,
              imageBlockCount: result.imageBlockCount,
              hasEffectiveImages: result.hasEffectiveImages,
              sourceUnchanged: result.sourceUnchanged,
              noImageCache: result.noImageCache
            }
          }
        )
      }
    })
  }, 30_000)

  it('human-pdf-read-image-collaboration', async () => {
    await runBackendCase({
      caseId: 'human-pdf-read-image-collaboration',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 PDF 页面图片路径可以通过 read_image 加入主模型上下文。',
      fixtures: [PDF_READING_FIXTURE_PATH],
      runMode: 'single',
      execute: async (runtime) => {
        const reference = buildSelectedPdfFixtureReference(runtime)
        const pdfHarness = createPdfToolHarness(runtime)
        const prepared = await pdfHarness.invoke<{
          pages: Array<{ pageImagePath: string }>
        }>('pdf_read_pages', {
          sourcePath: reference.absolutePath,
          selection: { type: 'page_numbers', pageNumbers: [9] }
        })
        await pdfHarness.release()
        const pageImagePath = prepared.pages[0]!.pageImagePath

        let imageBatchMessages: BaseMessage[] = []
        const runner = createHumanTestRunner(runtime, {
          selectedReferences: [reference],
          chatToolsWrapper: (chatTools) => async (request) => {
            if (request.caller === 'human.brain') {
              const index = request.messages.findIndex(
                (message) =>
                  AIMessage.isInstance(message) &&
                  message.tool_calls?.length === 3 &&
                  message.tool_calls[0]?.name === 'read_image'
              )
              if (index >= 0) imageBatchMessages = request.messages.slice(index)
            }
            return chatTools(request)
          },
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLoadToolsetsDecision({
                  toolsetNames: ['pdf-read'],
                  summary: '补齐 PDF 阅读能力。'
                })
              },
              {
                output: {
                  thought: { next: '先读取目标页面，取得正文和页面图片路径。' },
                  nextAction: {
                    action: 'hand',
                    calls: [
                      {
                        toolName: 'pdf_read_pages',
                        args: {
                          sourcePath: reference.absolutePath,
                          selection: { type: 'page_numbers', pageNumbers: [1, 9] }
                        }
                      }
                    ]
                  }
                }
              },
              {
                output: {
                  thought: { next: '使用上一轮返回的页面图片路径读取图片。' },
                  nextAction: {
                    action: 'hand',
                    calls: [
                      { toolName: 'read_image', args: { paths: [pageImagePath] } },
                      { toolName: 'load_toolset', args: { toolsetNames: ['ppt-read'] } },
                      { toolName: 'read_image', args: { paths: [pageImagePath] } }
                    ]
                  }
                }
              },
              {
                output: buildCompleteTaskDecision({
                  summary: 'PDF 文本和页面图片都已读取。',
                  deliveryMarkdown: '训练闭环和过度拟合页面已结合读取。'
                })
              }
            ]
          }
        })
        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '结合第1页文字和第9页图形说明训练闭环与过度拟合。'
        })
        const records = await runner.ctx.loadMessageLog()
        const batchIndex = records.findIndex(
          (record) =>
            record.entry.kind === 'assistant' &&
            record.entry.toolCalls.length === 3 &&
            record.entry.toolCalls[0]?.name === 'read_image'
        )
        const batchEntries = records
          .slice(batchIndex)
          .filter((record) => record.entry.kind !== 'annotation')
          .slice(0, 4)
          .map((record) => record.entry)
        const rebuilt = await projectMessagesForMainModel(messagesFromLogEntries(batchEntries))
        return {
          output,
          events: runtime.eventCollector.snapshot(),
          pageImagePath,
          imageBatchRoles: imageBatchMessages.map((message) => message.getType()),
          cacheMatchesLog:
            JSON.stringify(imageBatchMessages.map((message) => message.toDict())) ===
            JSON.stringify(rebuilt.map((message) => message.toDict()))
        }
      },
      assert: async (result, runtime) => {
        const starts = filterAiRunEventsByType(result.events, 'tool_call_started')
        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')

        runtime.assertThat(
          result.output.status === 'completed' &&
            result.cacheMatchesLog &&
            result.imageBatchRoles.join(',') === 'ai,tool,tool,tool,human' &&
            starts.some((event) => event.toolName === 'pdf_read_pages') &&
            starts.some((event) => event.toolName === 'read_image') &&
            toolResults.some(
              (event) => event.toolName === 'read_image' && event.result?.ok === true
            ) &&
            starts.findIndex((event) => event.toolName === 'pdf_read_pages') <
              starts.findIndex((event) => event.toolName === 'read_image'),
          {
            name: 'pdf-page-image-is-added-through-read-image',
            message: 'PDF 页面图片应通过 read_image 加入同一个主模型请求。',
            data: {
              toolNames: starts.map((event) => event.toolName),
              pageImagePath: result.pageImagePath
            }
          }
        )
      }
    })
  }, 30_000)
})
