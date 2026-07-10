import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createUtilityToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

type LocalOpenAiServer = {
  baseUrl: string
  close: () => Promise<void>
}

const startOpenAiCompatibleServer = async (input: {
  statusCode?: number
  content?: string
}): Promise<LocalOpenAiServer> => {
  const sockets = new Set<Socket>()
  const server = createServer((request, response) => {
    if (request.method === 'POST' && (request.url || '').includes('/chat/completions')) {
      request.resume()
      if ((input.statusCode || 200) >= 400) {
        response.writeHead(input.statusCode || 500, {
          'content-type': 'application/json; charset=utf-8'
        })
        response.end(
          JSON.stringify({
            error: {
              message: input.content || 'vision provider unavailable'
            }
          })
        )
        return
      }

      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8'
      })
      response.end(
        JSON.stringify({
          id: 'chatcmpl-llm-recognize',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-5',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: input.content || ''
              },
              finish_reason: 'stop'
            }
          ]
        })
      )
      return
    }

    response.writeHead(404, {
      'content-type': 'application/json; charset=utf-8'
    })
    response.end(JSON.stringify({ error: { message: 'not found' } }))
  })

  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    for (const socket of sockets) socket.destroy()
    throw new Error('failed to start local OpenAI-compatible server')
  }

  return {
    baseUrl: `http://127.0.0.1:${String((address as AddressInfo).port)}/v1`,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    }
  }
}

const seedActiveConfig = async (
  runtime: Parameters<Parameters<typeof runBackendCase>[0]['execute']>[0],
  baseUrl: string
): Promise<void> => {
  await runtime.seedLlmConfig({
    id: 'cfg-llm-recognize',
    name: '图像识别测试配置',
    providerKind: 'openai-compatible',
    base_url: baseUrl,
    model_name: 'gpt-5',
    api_key: 'test-key'
  })
}

const writeFixtureImage = async (workspaceRoot: string): Promise<string> => {
  const imagePath = path.join(workspaceRoot, 'sample-image.png')
  await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  return imagePath
}

describe('ai tool image recognition backend', () => {
  it('llm-recognize-contract', async () => {
    await runBackendCase({
      caseId: 'llm-recognize-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['utility'],
      description: '验证 llm_recognize 成功时解析图像识别协议并返回 result。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const server = await startOpenAiCompatibleServer({
          content: JSON.stringify({
            supports_image_recognition: true,
            result: '这是一张蓝底截图，中间有白色字母 DS。'
          })
        })
        try {
          await seedActiveConfig(runtime, server.baseUrl)
          const imagePath = await writeFixtureImage(runtime.workspaceRoot)
          const harness = createUtilityToolHarness(runtime, {
            modelName: 'gpt-5'
          })
          return await harness.invoke<string>('llm_recognize', {
            path: imagePath,
            instruction: '请描述图片内容。'
          })
        } finally {
          await server.close()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(result === '这是一张蓝底截图，中间有白色字母 DS。', {
          name: 'llm-recognize-returns-protocol-result',
          message: 'llm_recognize 成功时应返回图像识别协议里的 result。',
          data: result
        })
      }
    })
  })

  it('llm-recognize-uncertain-text-contract', async () => {
    await runBackendCase({
      caseId: 'llm-recognize-uncertain-text-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['utility'],
      description: '验证 llm_recognize 在模型无法确认图片细节时仍返回协议 result。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const server = await startOpenAiCompatibleServer({
          content: JSON.stringify({
            supports_image_recognition: true,
            result: '我无法确认这张图片里的具体品牌，但能看出是一个深色界面截图。'
          })
        })
        try {
          await seedActiveConfig(runtime, server.baseUrl)
          const imagePath = await writeFixtureImage(runtime.workspaceRoot)
          const harness = createUtilityToolHarness(runtime, {
            modelName: 'gpt-5'
          })
          return await harness.invoke<string>('llm_recognize', {
            path: imagePath,
            instruction: '请尽量描述图片内容，不确定的地方直接说明。'
          })
        } finally {
          await server.close()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          typeof result === 'string' && result.includes('无法确认') && result.includes('界面截图'),
          {
            name: 'llm-recognize-returns-uncertain-protocol-result',
            message: 'llm_recognize 对无法确认类文本也应返回协议 result。',
            data: result
          }
        )
      }
    })
  })

  it('llm-recognize-unsupported-vision-contract', async () => {
    await runBackendCase({
      caseId: 'llm-recognize-unsupported-vision-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['utility'],
      description: '验证 llm_recognize 在模型声明不支持图像识别时返回固定 error 文案。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const server = await startOpenAiCompatibleServer({
          content: JSON.stringify({
            supports_image_recognition: false,
            result: ''
          })
        })
        try {
          await seedActiveConfig(runtime, server.baseUrl)
          const imagePath = await writeFixtureImage(runtime.workspaceRoot)
          const harness = createUtilityToolHarness(runtime, {
            modelName: 'gpt-5'
          })
          return await harness.invoke<{ error?: string }>('llm_recognize', {
            path: imagePath,
            instruction: '请描述图片内容。'
          })
        } finally {
          await server.close()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          typeof result === 'object' &&
            result !== null &&
            result.error ===
              '当前模型 gpt-5 不支持图像识别，请提示用户切换支持图片输入的模型后再试',
          {
            name: 'llm-recognize-returns-fixed-unsupported-vision-error',
            message: '模型协议返回不支持图像识别时，llm_recognize 应返回固定 error 文案。',
            data: result
          }
        )
      }
    })
  })

  it('llm-recognize-bottom-error-contract', async () => {
    await runBackendCase({
      caseId: 'llm-recognize-bottom-error-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['utility'],
      description: '验证 llm_recognize 底层失败时返回 error 结果。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const server = await startOpenAiCompatibleServer({
          statusCode: 500,
          content: 'vision provider unavailable'
        })
        try {
          await seedActiveConfig(runtime, server.baseUrl)
          const imagePath = await writeFixtureImage(runtime.workspaceRoot)
          const harness = createUtilityToolHarness(runtime, {
            modelName: 'gpt-5'
          })
          return await harness.invoke<{ error?: string }>('llm_recognize', {
            path: imagePath,
            instruction: '请描述图片内容。'
          })
        } finally {
          await server.close()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          typeof result === 'object' &&
            result !== null &&
            typeof result.error === 'string' &&
            result.error.trim().length > 0,
          {
            name: 'llm-recognize-returns-error-on-bottom-failure',
            message: 'llm_recognize 只有底层调用失败时才应返回 error。',
            data: result
          }
        )
      }
    })
  })
})
