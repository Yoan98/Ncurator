import { createServer } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { buildSelectedDocxFixtureReferences } from '../../../../harness/backend/aiLiveTestData'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  buildToolDecision,
  filterAiRunEventsByType,
  readLatestToolResultDataFromEvents
} from '../testUtils'

const FIXTURE = 'tests/fixtures/workspace/灵感测试.docx'

const startVisionServer = async (): Promise<{ baseUrl: string; close: () => Promise<void> }> => {
  const sockets = new Set<Socket>()
  const server = createServer((request, response) => {
    request.resume()
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    response.end(
      JSON.stringify({
        id: 'chatcmpl-docx-human-vision',
        object: 'chat.completion',
        created: 1,
        model: 'gpt-5',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({
                supports_image_recognition: true,
                result: '图片展示了可辨认的灵感测试内容。'
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
    server.listen(0, '127.0.0.1', resolve)
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

const findVisualId = (value: unknown): string => {
  const stack: unknown[] = [value]
  while (stack.length > 0) {
    const current = stack.pop()
    if (Array.isArray(current)) {
      stack.push(...current)
      continue
    }
    if (!current || typeof current !== 'object') continue
    const node = current as { type?: string; visualId?: string; children?: unknown[] }
    if (node.type === 'visual' && node.visualId) return node.visualId
    stack.push(...(node.children || []))
  }
  return ''
}

describe('ai human mock-llm backend', () => {
  it('human-docx-read-visuals-collaboration', async () => {
    await runBackendCase({
      caseId: 'human-docx-read-visuals-collaboration',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证模型看到 DOCX visual 节点后可自主选择视觉读取工具。',
      fixtures: [FIXTURE],
      runMode: 'single',
      execute: async (runtime) => {
        const visionServer = await startVisionServer()
        try {
          await runtime.seedLlmConfig({
            id: 'mock-llm-scripted',
            name: 'DOCX 图像识别测试配置',
            providerKind: 'openai-compatible',
            base_url: visionServer.baseUrl,
            model_name: 'gpt-5',
            api_key: 'test-key'
          })
          const reference = buildSelectedDocxFixtureReferences(runtime, [FIXTURE])[0]!
          const runner = createHumanTestRunner(runtime, {
            modelName: 'gpt-5',
            selectedReferences: [reference],
            allowedToolNames: ['docx_read_outline', 'docx_read_blocks', 'docx_read_visuals'],
            structuredOutputScript: {
              'human.brain': [
                {
                  output: buildLearnSkillsDecision({
                    skillIds: ['docx-read'],
                    summary: '读取 DOCX 内容。'
                  })
                },
                {
                  output: buildToolDecision({
                    toolName: 'docx_read_outline',
                    args: {
                      sourcePath: reference.absolutePath,
                      ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 100 }]
                    },
                    summary: '查看文档结构。'
                  })
                },
                () => {
                  const outline = readLatestToolResultDataFromEvents<{
                    blocks: Array<{ blockId: string; visuals?: { count: number } }>
                  }>(runtime.eventCollector.snapshot(), 'docx_read_outline')
                  const visualBlock = outline.blocks.find((block) => block.visuals?.count)
                  if (!visualBlock) throw new Error('outline is missing visual summary')
                  return buildToolDecision({
                    toolName: 'docx_read_blocks',
                    args: {
                      sourcePath: reference.absolutePath,
                      range: { type: 'block_ids', blockIds: [visualBlock.blockId] }
                    },
                    summary: '读取含视觉内容的结构。'
                  })
                },
                (input) => {
                  if (!input.user.includes('"type":"visual"') || !input.user.includes('visualId')) {
                    throw new Error('brain prompt is missing recursive visual node')
                  }
                  const read = readLatestToolResultDataFromEvents<{ blocks: unknown[] }>(
                    runtime.eventCollector.snapshot(),
                    'docx_read_blocks'
                  )
                  const visualId = findVisualId(read.blocks)
                  if (!visualId) throw new Error('recursive tree is missing visualId')
                  return buildToolDecision({
                    toolName: 'docx_read_visuals',
                    args: {
                      sourcePath: reference.absolutePath,
                      requests: [{ visualId, instruction: '说明图片展示的内容。' }]
                    },
                    summary: '识别所选视觉内容。'
                  })
                },
                (input) => {
                  if (!input.user.includes('灵感测试内容')) {
                    throw new Error('brain prompt is missing visual recognition result')
                  }
                  return buildCompleteTaskDecision({ summary: 'DOCX 图文内容已读取。' })
                }
              ],
              'human.mouth': [
                {
                  output: {
                    summary: 'DOCX 图文内容已读取。',
                    deliveryMarkdown: '已读取文档中的文字结构和图片内容。'
                  }
                }
              ]
            }
          })
          const output = await runner.run({
            taskId: runtime.taskId,
            userInput: '请结合这份 DOCX 里的文字和图片说明内容。'
          })
          return { output, events: runtime.eventCollector.snapshot() }
        } finally {
          await visionServer.close()
        }
      },
      assert: async (result, runtime) => {
        const starts = filterAiRunEventsByType(result.events, 'tool_call_started')
        const results = filterAiRunEventsByType(result.events, 'tool_call_result')
        runtime.assertThat(
          result.output.status === 'completed' &&
            starts.map((event) => event.toolName).join(',') ===
              'docx_read_outline,docx_read_blocks,docx_read_visuals' &&
            results.some(
              (event) =>
                event.toolName === 'docx_read_visuals' &&
                event.result?.ok === true &&
                JSON.stringify(event.result.data).includes('灵感测试内容')
            ) &&
            !starts.some((event) => event.toolName === 'image_analyze'),
          {
            name: 'docx-visual-node-enables-model-selected-visual-reading',
            message: '模型应能从递归 visual 节点取得 visualId，并直接调用 DOCX 视觉读取工具。',
            data: { toolNames: starts.map((event) => event.toolName) }
          }
        )
      }
    })
  }, 30_000)
})
