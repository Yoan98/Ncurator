import { createServer } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
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
  filterAiRunEventsByType
} from '../testUtils'

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

describe('ai human mock-llm backend', () => {
  it('human-pdf-read-visuals-collaboration', async () => {
    await runBackendCase({
      caseId: 'human-pdf-read-visuals-collaboration',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 PDF 页面视觉读取可在一次工具调用中返回识图结果。',
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
            structuredOutputScript: {
              'human.brain': [
                {
                  output: buildLearnSkillsDecision({
                    skillIds: ['pdf-read'],
                    summary: '补齐 PDF 阅读能力。'
                  })
                },
                {
                  output: {
                    thought: { next: '读取文本并识别需要观察的页面视觉内容。' },
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
                          toolName: 'pdf_read_visuals',
                          args: {
                            sourcePath: reference.absolutePath,
                            requests: [
                              {
                                index: 9,
                                instruction: '说明 Proper fit 和 Overfit 两组曲线的直观差异。'
                              }
                            ]
                          }
                        }
                      ]
                    }
                  }
                },
                {
                  output: buildCompleteTaskDecision({
                    summary: 'PDF 文本和图片信息都已读取。',
                    deliveryMarkdown:
                      '训练闭环由 inputs、parameters、architecture、predictions、labels、loss 和 update 组成；Overfit 时训练与验证表现差距明显。'
                  })
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

        runtime.assertThat(
          result.output.status === 'completed' &&
            starts.some((event) => event.toolName === 'pdf_read_pages') &&
            starts.some((event) => event.toolName === 'pdf_read_visuals') &&
            toolResults.some(
              (event) =>
                event.toolName === 'pdf_read_visuals' &&
                event.result?.ok === true &&
                JSON.stringify(event.result.data).includes('验证曲线')
            ) &&
            !starts.some(
              (event) => event.toolName === 'pdf_render_pages' || event.toolName === 'image_analyze'
            ),
          {
            name: 'pdf-read-visuals-returns-recognition-result-directly',
            message:
              'PDF 页面视觉读取应直接返回识图文本，不再暴露 render 路径或依赖 image_analyze。',
            data: { toolNames: starts.map((event) => event.toolName) }
          }
        )
      }
    })
  }, 30_000)
})
