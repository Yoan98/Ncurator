import http from 'node:http'
import { describe, it } from 'vitest'
import { createWebToolHarness } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

type WebFetchResult = {
  url?: string
  statusCode?: number
  title?: string
  text?: string
  error?: string
  reason?: string
  decisionHint?: {
    code: string
    detail: {
      toolName: string
      estimatedTokens: number
      limit: number
    }
  }
}

type BrowserUseResult = {
  error?: string
}

const createLocalServer = async (): Promise<{
  baseUrl: string
  close: () => Promise<void>
}> => {
  const server = http.createServer((request, response) => {
    const path = request.url || '/'
    if (path === '/redirect') {
      response.statusCode = 302
      response.setHeader('Location', '/ok')
      response.end()
      return
    }
    if (path === '/missing') {
      response.statusCode = 404
      response.end('<html><title>missing</title><body>not found</body></html>')
      return
    }
    if (path === '/large') {
      response.statusCode = 200
      response.end(`<html><title>Large</title><body>${'large result text '.repeat(500)}</body></html>`)
      return
    }
    response.statusCode = 200
    response.end(
      '<html><head><title>Fetch Contract</title></head><body><main><h1>Alpha</h1><p>Beta content.</p></main><script>ignored()</script></body></html>'
    )
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('local server address unavailable')
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    close: async () => {
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

describe('ai tool web backend', () => {
  it('web-fetch-contract', async () => {
    await runBackendCase({
      caseId: 'web-fetch-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['web-browsing'],
      description: '验证 web_fetch 成功抓取、redirect 最终 URL、HTTP 失败和结果过大。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const server = await createLocalServer()
        try {
          const harness = createWebToolHarness(runtime)
          const smallLimitHarness = createWebToolHarness(runtime, {
            humanRuntimeOverrides: {
              modelContextWindowTokens: 20
            }
          })
          return {
            ok: await harness.invoke<WebFetchResult>('web_fetch', {
              url: `${server.baseUrl}/ok`
            }),
            redirect: await harness.invoke<WebFetchResult>('web_fetch', {
              url: `${server.baseUrl}/redirect`
            }),
            missing: await harness.invoke<WebFetchResult>('web_fetch', {
              url: `${server.baseUrl}/missing`
            }),
            tooLarge: await smallLimitHarness.invoke<WebFetchResult>('web_fetch', {
              url: `${server.baseUrl}/large`
            })
          }
        } finally {
          await server.close()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.ok.statusCode === 200 &&
            result.ok.title === 'Fetch Contract' &&
            Boolean(result.ok.text?.includes('Alpha')) &&
            Boolean(result.ok.text?.includes('Beta content.')) &&
            !result.ok.text?.includes('ignored'),
          {
            name: 'web-fetch-returns-readable-text',
            message: 'web_fetch 应返回最终 URL、HTTP 状态、标题和抽取后的正文文本。',
            data: result.ok
          }
        )

        runtime.assertThat(
          result.redirect.statusCode === 200 &&
            Boolean(result.redirect.url?.endsWith('/ok')) &&
            Boolean(result.redirect.text?.includes('Alpha')),
          {
            name: 'web-fetch-returns-final-redirect-url',
            message: 'web_fetch 跟随 redirect 后应返回最终 URL。',
            data: result.redirect
          }
        )

        runtime.assertThat(
          result.missing.statusCode === 404 &&
            Boolean(result.missing.error?.includes('404')),
          {
            name: 'web-fetch-preserves-http-failure-status',
            message: 'web_fetch HTTP 失败时应保留状态码和真实错误文本。',
            data: result.missing
          }
        )

        runtime.assertThat(
          result.tooLarge.reason === 'result_too_large' &&
            result.tooLarge.decisionHint?.code === 'hand_tool_result_too_large' &&
            result.tooLarge.decisionHint.detail.toolName === 'web_fetch',
          {
            name: 'web-fetch-too-large-uses-shared-decision-hint',
            message: 'web_fetch 结果过大时应走统一 hand_tool_result_too_large 兜底。',
            data: result.tooLarge
          }
        )
      }
    })
  })

  it('browser-use-service-unavailable-diagnostic', async () => {
    await runBackendCase({
      caseId: 'browser-use-service-unavailable-diagnostic',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['web-browsing'],
      description: '验证 browser_use 在缺少内置浏览器服务时返回真实 diagnostic。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const harness = createWebToolHarness(runtime)
        return await harness.invoke<BrowserUseResult>('browser_use', {
          action: 'extract',
          instruction: '读取当前网页正文'
        })
      },
      assert: async (result, runtime) => {
        runtime.assertThat(result.error === 'browser_use service unavailable', {
          name: 'browser-use-missing-service-returns-diagnostic',
          message: 'browser_use 缺少内置浏览器服务时应通过工具结果返回真实错误。',
          data: result
        })
      }
    })
  })
})
