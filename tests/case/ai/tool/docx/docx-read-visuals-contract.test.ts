import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createDocxToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

const FIXTURE = path.resolve('tests/fixtures/workspace/灵感测试.docx')

const startVisionServer = async () => {
  const sockets = new Set<Socket>()
  let requestCount = 0
  const server = createServer((request, response) => {
    request.resume()
    requestCount += 1
    if (requestCount === 1) {
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ error: { message: 'first visual failed' } }))
      return
    }
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    response.end(
      JSON.stringify({
        id: 'chatcmpl-docx-visual',
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
                result: '图片中包含可辨认的测试视觉内容。'
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
  while (stack.length) {
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

describe('ai tool docx visuals backend', () => {
  it('docx-read-visuals-contract', async () => {
    await runBackendCase({
      caseId: 'docx-read-visuals-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 DOCX visualId 能按需读取图片并逐项返回识别结果或错误。',
      fixtures: [FIXTURE],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = runtime.getFixtureWorkspacePath(FIXTURE)
        const server = await startVisionServer()
        try {
          await runtime.seedLlmConfig({
            id: 'ai-live-config',
            name: 'DOCX vision',
            providerKind: 'openai-compatible',
            base_url: server.baseUrl,
            model_name: 'gpt-5',
            api_key: 'test-key'
          })
          const harness = createDocxToolHarness(runtime, { modelName: 'gpt-5' })
          try {
            const before = createHash('sha256')
              .update(await fs.readFile(sourcePath))
              .digest('hex')
            const outline = await harness.invoke<{
              blocks: Array<{ blockId: string; visuals?: { count: number } }>
            }>('docx_read_outline', {
              sourcePath,
              ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 100 }]
            })
            const owner = outline.blocks.find((block) => block.visuals?.count)
            const read = await harness.invoke<{ blocks: unknown[] }>('docx_read_blocks', {
              sourcePath,
              range: { type: 'block_ids', blockIds: [owner!.blockId] }
            })
            const visualId = findVisualId(read.blocks)
            const visual = await harness.invoke<{
              results: Array<{ visualId: string; text?: string; error?: string }>
            }>('docx_read_visuals', {
              sourcePath,
              requests: [
                { visualId, instruction: '说明图片内容。' },
                { visualId, instruction: '再次说明图片内容。' },
                { visualId: 'visual_stale', instruction: '说明图片内容。' }
              ]
            })
            if (!Array.isArray(visual.results)) throw new Error(JSON.stringify(visual))
            const after = createHash('sha256')
              .update(await fs.readFile(sourcePath))
              .digest('hex')
            return { visualId, visual, before, after }
          } finally {
            await harness.release()
          }
        } finally {
          await server.close()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.visual.results[0]?.visualId === result.visualId &&
            typeof result.visual.results[0]?.error === 'string' &&
            result.visual.results[1]?.visualId === result.visualId &&
            result.visual.results[1]?.text?.includes('测试视觉内容') === true &&
            result.visual.results[2]?.visualId === 'visual_stale' &&
            result.visual.results[2]?.error?.includes('stale or unknown') === true,
          {
            name: 'docx-visual-results-keep-request-order',
            message: 'DOCX 视觉读取应按顺序返回成功或单项错误。',
            data: result.visual
          }
        )
        runtime.assertThat(result.before === result.after, {
          name: 'docx-visual-read-keeps-source-checksum',
          message: 'DOCX 视觉读取不得修改源文件。'
        })
      }
    })
  })
})
