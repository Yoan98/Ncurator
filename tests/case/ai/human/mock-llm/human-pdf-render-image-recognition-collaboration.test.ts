import { createServer } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  buildSelectedPdfFixtureReference,
  PDF_READING_FIXTURE_PATH
} from '../../../../harness/backend/aiLiveTestData'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  buildToolDecision,
  filterAiRunEventsByType
} from '../testUtils'
import type { JsonObject } from '../../../../../src/shared/types'

const startVisionServer = async (): Promise<{ baseUrl: string; close: () => Promise<void> }> => {
  const sockets = new Set<Socket>()
  const server = createServer((request, response) => {
    request.resume()
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    response.end(
      JSON.stringify({
        id: 'chatcmpl-pdf-vision',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'gpt-5',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({
                supports_image_recognition: true,
                result: '第9页右侧 Overfit 图中训练曲线继续改善，但验证曲线变差，二者差距明显。'
              })
            },
            finish_reason: 'stop'
          }
        ]
      })
    )
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}/v1`,
    close: async () => {
      sockets.forEach((socket) => socket.destroy())
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  }
}

const renderedPathsFromData = (data: unknown): string[] => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return []
  const images = (data as JsonObject).images
  if (!Array.isArray(images)) return []
  return images.flatMap((image) => {
    if (!image || typeof image !== 'object' || Array.isArray(image)) return []
    return typeof image.path === 'string' ? [image.path] : []
  })
}

describe('ai human mock-llm backend', () => {
  it('human-pdf-render-image-recognition-collaboration', async () => {
    await runBackendCase({
      caseId: 'human-pdf-render-image-recognition-collaboration',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 PDF 页面图片路径会回流给 brain，并可继续交给通用图像识别工具。',
      fixtures: [PDF_READING_FIXTURE_PATH],
      runMode: 'single',
      execute: async (runtime) => {
        const visionServer = await startVisionServer()
        try {
          await runtime.seedLlmConfig({
            id: 'mock-llm-scripted',
            name: 'PDF 图像识别测试配置',
            providerKind: 'openai-compatible',
            base_url: visionServer.baseUrl,
            model_name: 'gpt-5',
            api_key: 'test-key'
          })
          const reference = buildSelectedPdfFixtureReference(runtime)
          const runner = createHumanTestRunner(runtime, {
            modelName: 'gpt-5',
            selectedReferences: [reference],
            allowedToolNames: ['pdf_read_pages', 'pdf_render_pages', 'image_analyze'],
            structuredOutputScript: {
              'human.brain': [
                {
                  output: buildLearnSkillsDecision({
                    skillIds: ['pdf-read', 'image-recognition'],
                    summary: '补齐 PDF 阅读和图像识别能力。'
                  })
                },
                {
                  output: {
                    thought: { next: '读取文本并渲染需要观察的页面。' },
                    nextAction: {
                      action: 'hand',
                      calls: [
                        {
                          toolName: 'pdf_read_pages',
                          args: {
                            sourcePath: reference.absolutePath,
                            selection: { type: 'page_numbers', pageNumbers: [1, 9] }
                          }
                        },
                        {
                          toolName: 'pdf_render_pages',
                          args: {
                            sourcePath: reference.absolutePath,
                            pageNumbers: [9]
                          }
                        }
                      ]
                    }
                  }
                },
                ({ user }) => {
                  const imagePath = user.match(
                    /[^\s"<>]*\.ncurator\/runtime\/assets\/[^/\s"<>]+\/page-9\.png/u
                  )?.[0]
                  if (!imagePath)
                    throw new Error('rendered page-9 image path missing from brain prompt')
                  return buildToolDecision({
                    toolName: 'image_analyze',
                    args: {
                      path: imagePath,
                      instruction: '说明 Proper fit 和 Overfit 两组曲线的直观差异。'
                    },
                    summary: '识别第9页对比图。'
                  })
                },
                {
                  output: buildCompleteTaskDecision({
                    summary: 'PDF 文本和图片信息都已读取。'
                  })
                }
              ],
              'human.mouth': [
                {
                  output: {
                    summary: '已完成 PDF 图文阅读。',
                    deliveryMarkdown:
                      '训练闭环由 inputs、parameters、architecture、predictions、labels、loss 和 update 组成；Overfit 时训练与验证表现差距明显。'
                  }
                }
              ]
            }
          })
          const output = await runner.run({
            taskId: runtime.taskId,
            userInput: '结合第1页文字和第9页图形说明训练闭环与过度拟合。'
          })
          return { output, events: runtime.eventCollector.snapshot() }
        } finally {
          await visionServer.close()
        }
      },
      assert: async (result, runtime) => {
        const starts = filterAiRunEventsByType(result.events, 'tool_call_started')
        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')
        const renderPaths = toolResults
          .filter((event) => event.toolName === 'pdf_render_pages' && event.result?.ok === true)
          .flatMap((event) => renderedPathsFromData(event.result?.data))
        const recognizePaths = starts
          .filter((event) => event.toolName === 'image_analyze')
          .map((event) => event.input.path)
          .filter((value): value is string => typeof value === 'string')

        runtime.assertThat(
          result.output.status === 'completed' &&
            starts.some((event) => event.toolName === 'pdf_read_pages') &&
            renderPaths.some((imagePath) => path.basename(imagePath) === 'page-9.png') &&
            recognizePaths.some((imagePath) => renderPaths.includes(imagePath)) &&
            toolResults.some(
              (event) =>
                event.toolName === 'image_analyze' &&
                event.result?.ok === true &&
                JSON.stringify(event.result.data).includes('验证曲线')
            ),
          {
            name: 'pdf-render-path-feeds-generic-image-recognition',
            message: 'PDF 渲染结果中的真实图片路径应进入下一轮 brain，并交给 image_analyze。',
            data: { renderPaths, recognizePaths }
          }
        )
      }
    })
  })
})
