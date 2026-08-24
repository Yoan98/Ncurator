import http from 'node:http'
import { describe, it } from 'vitest'
import { createWebToolHarness } from '../../../../harness/backend/aiToolHarness'
import { createWebCrawlerService } from '../../../../harness/backend/webCrawlerTestUtils'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

type WebSearchResult = {
  requestedUrl?: string
  finalUrl?: string
  title?: string
  markdown?: string
  publishedAt?: string
  links?: {
    internal?: Array<{
      href?: string
      text?: string
      title?: string
      intrinsicScore?: number
      contextualScore?: number
      totalScore?: number
    }>
    external?: Array<{
      href?: string
      text?: string
      title?: string
      intrinsicScore?: number
      contextualScore?: number
      totalScore?: number
    }>
  }
  error?: string
  statusCode?: number
  estimatedTokens?: number
  limit?: number
}

type BrowserUseResult = {
  action?: 'navigate' | 'observe' | 'act' | 'extract'
  page?: {
    url: string
    title?: string
  }
  result?: unknown
  error?: string
}

const createLocalServer = async (): Promise<{
  baseUrl: string
  close: () => Promise<void>
}> => {
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    const currentPath = request.url || '/'
    if (currentPath === '/missing') {
      response.statusCode = 404
      response.end('<html><title>missing</title><body>not found</body></html>')
      return
    }
    if (currentPath === '/policy') {
      response.statusCode = 200
      response.end(`
        <html>
          <head>
            <title>灵活就业补贴申报通知</title>
            <meta property="article:published_time" content="2026-06-10" />
          </head>
          <body>
            <main>
              灵活就业人员可申请本次补贴，申报截止时间为 2026-09-30。
            </main>
            <a href="/guide">查看办理指南</a>
          </body>
        </html>
      `)
      return
    }
    if (currentPath === '/guide') {
      response.statusCode = 200
      response.end(`
        <html>
          <head><title>灵活就业补贴办理指南</title></head>
          <body>
            <main>
              办理材料包括身份证、社保缴费证明和申请表。可在线提交申请。
            </main>
            <a href="/policy">返回补贴通知</a>
          </body>
        </html>
      `)
      return
    }
    if (currentPath === '/large') {
      response.statusCode = 200
      response.end(`
        <html>
          <head><title>超长通知页</title></head>
          <body>
            <main>${'补贴说明内容。'.repeat(1_200)}</main>
            <a href="/policy">返回通知</a>
          </body>
        </html>
      `)
      return
    }
    response.statusCode = 200
    response.end(`
      <html>
        <head><title>就业服务首页</title></head>
        <body>
          <main>这里汇总了通知公告和办事指南。</main>
          <a href="/policy">灵活就业补贴申报通知</a>
          <a href="/guide">灵活就业补贴办理指南</a>
        </body>
      </html>
    `)
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
  it('web-search-reads-page-by-url', async () => {
    await runBackendCase({
      caseId: 'web-search-reads-page-by-url',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['web-browsing'],
      description: '验证 web_search 传 url 会返回该页面的标题、markdown、发布时间与后续链接。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const server = await createLocalServer()
        const webCrawlerService = createWebCrawlerService()
        try {
          const harness = createWebToolHarness(runtime, {
            webCrawlerService
          })
          return await harness.invoke<WebSearchResult>('web_search', {
            url: `${server.baseUrl}/policy`
          })
        } finally {
          await webCrawlerService.close()
          await server.close()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.requestedUrl?.endsWith('/policy') === true &&
            result.finalUrl?.endsWith('/policy') === true &&
            result.title === '灵活就业补贴申报通知' &&
            result.publishedAt === '2026-06-10' &&
            Boolean(result.markdown?.includes('申报截止时间为 2026-09-30')) &&
            Array.isArray(result.links?.internal) &&
            result.links.internal.some((link) => link.href?.endsWith('/guide')) &&
            result.links.internal.some(
              (link) =>
                typeof link.intrinsicScore === 'number' &&
                typeof link.contextualScore === 'number' &&
                typeof link.totalScore === 'number'
            ),
          {
            name: 'web-search-returns-stable-page-fields',
            message:
              'web_search 传 url 应返回 requestedUrl/finalUrl、标题、发布时间、markdown 和带评分的分组 links。',
            data: result
          }
        )
      }
    })
  })

  it('web-search-reads-content-by-query', async () => {
    await runBackendCase({
      caseId: 'web-search-reads-content-by-query',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['web-browsing'],
      description: '验证 web_search 传 query 会搜索并并行爬取全部候选网页，返回数组（失败项带 error）。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const harness = createWebToolHarness(runtime, {
          webCrawlerService: {
            async search(input) {
              return {
                query: input.query,
                results: [
                  {
                    rank: 1,
                    title: 'DeepSeek 510亿A轮融资全解析',
                    url: 'https://example.com/deepseek-funding',
                    snippet: 'DeepSeek 完成首轮外部融资 510 亿元。'
                  },
                  {
                    rank: 2,
                    title: 'DeepSeek 融资详情',
                    url: 'https://example.com/deepseek-details',
                    snippet: '融资细节。'
                  }
                ],
                raw: {
                  query: input.query,
                  results: []
                }
              }
            },
            async crawl(input) {
              if (input.url === 'https://example.com/deepseek-details') {
                throw new Error('网页请求失败：403')
              }
              return {
                requestedUrl: input.url,
                finalUrl: input.url,
                title: 'DeepSeek 510亿A轮融资全解析',
                markdown: 'DeepSeek 完成首轮外部融资 510 亿元。',
                links: { internal: [], external: [] },
                raw: {}
              }
            },
            async close() {
              return
            }
          }
        })
        return await harness.invoke<WebSearchResult[]>('web_search', {
          query: '最近 DeepSeek 融资情况'
        })
      },
      assert: async (result, runtime) => {
        const firstOk = result.find((item) => item.markdown)
        runtime.assertThat(
          Array.isArray(result) &&
            result.length === 2 &&
            result.some((item) => item.error === '网页请求失败：403') &&
            Boolean(firstOk?.markdown?.includes('510 亿元')) &&
            firstOk?.requestedUrl === 'https://example.com/deepseek-funding',
          {
            name: 'web-search-returns-array-by-query',
            message:
              'web_search 传 query 应并行爬取候选网页并返回数组，成功项带 markdown、失败项带 error。',
            data: result
          }
        )
      }
    })
  })

  it('web-search-reads-entry-page', async () => {
    await runBackendCase({
      caseId: 'web-search-reads-entry-page',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['web-browsing'],
      description: '验证 web_search 传 url 只读取该网页并保留页面链接。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const server = await createLocalServer()
        const webCrawlerService = createWebCrawlerService()
        try {
          const harness = createWebToolHarness(runtime, {
            webCrawlerService
          })
          return await harness.invoke<WebSearchResult>('web_search', {
            url: `${server.baseUrl}/`
          })
        } finally {
          await webCrawlerService.close()
          await server.close()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.requestedUrl?.endsWith('/') === true &&
            result.title === '就业服务首页' &&
            Boolean(result.markdown?.includes('这里汇总了通知公告和办事指南')) &&
            Array.isArray(result.links?.internal) &&
            result.links.internal.some((link) => link.href?.endsWith('/policy')),
          {
            name: 'web-search-reads-entry-page-without-auto-follow',
            message: 'web_search 传 url 应读取该网页并返回页面链接，不再自动跟进其他链接。',
            data: result
          }
        )
      }
    })
  })

  it('web-search-http-failure', async () => {
    await runBackendCase({
      caseId: 'web-search-http-failure',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['web-browsing'],
      description: '验证 web_search 传 url 遇到 HTTP 失败时会保留错误文本、最终 URL 和状态码。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const server = await createLocalServer()
        const webCrawlerService = createWebCrawlerService()
        try {
          const harness = createWebToolHarness(runtime, {
            webCrawlerService
          })
          return await harness.invoke<WebSearchResult>('web_search', {
            url: `${server.baseUrl}/missing`
          })
        } finally {
          await webCrawlerService.close()
          await server.close()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.error === '网页请求失败：404' &&
            result.statusCode === 404 &&
            result.requestedUrl?.endsWith('/missing') === true &&
            result.finalUrl?.endsWith('/missing') === true,
          {
            name: 'web-search-preserves-http-failure-fields',
            message: 'web_search HTTP 失败时应保留错误文本、requestedUrl/finalUrl 和状态码。',
            data: result
          }
        )
      }
    })
  })

  it('web-search-returns-full-content-without-tool-level-truncation', async () => {
    await runBackendCase({
      caseId: 'web-search-returns-full-content-without-tool-level-truncation',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['web-browsing'],
      description:
        '验证 web_search 不再在工具层对过大结果硬失败，完整正文直接返回，由 hand 层统一截断落盘。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const server = await createLocalServer()
        const webCrawlerService = createWebCrawlerService()
        try {
          const harness = createWebToolHarness(runtime, {
            webCrawlerService,
            humanRuntimeOverrides: {
              modelContextWindowTokens: 20
            }
          })
          return await harness.invoke<WebSearchResult>('web_search', {
            url: `${server.baseUrl}/large`
          })
        } finally {
          await webCrawlerService.close()
          await server.close()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.requestedUrl?.endsWith('/large') === true &&
            result.finalUrl?.endsWith('/large') === true &&
            typeof result.markdown === 'string' &&
            result.markdown.length > 0 &&
            ('error' in result) === false,
          {
            name: 'web-search-returns-full-content',
            message: 'web_search 结果过大时不再硬失败，完整正文由 hand 层统一截断落盘。',
            data: result
          }
        )
      }
    })
  })

  it('browser-use-service-unavailable-error', async () => {
    await runBackendCase({
      caseId: 'browser-use-service-unavailable-error',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['web-browsing'],
      description: '验证 browser_use 在缺少内置浏览器服务时返回真实 error。',
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
          name: 'browser-use-missing-service-returns-error',
          message: 'browser_use 缺少内置浏览器服务时应通过工具结果返回真实错误。',
          data: result
        })
      }
    })
  })

  it('browser-use-keeps-one-tab-for-the-whole-run', async () => {
    await runBackendCase({
      caseId: 'browser-use-keeps-one-tab-for-the-whole-run',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['web-browsing'],
      description: '验证同一轮 AI Run 的多次 browser_use 调用始终使用首次绑定的浏览器标签。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await runtime.seedLlmConfig({
          id: 'ai-live-config',
          name: 'Browser tab binding test model',
          providerKind: 'openai-compatible',
          base_url: 'https://example.com/v1',
          model_name: 'browser-tab-binding-test',
          api_key: 'test-key'
        })
        const ensuredTabIds = ['automation-tab-a', 'ui-active-tab-b']
        const runTabIds: string[] = []
        let ensureCallCount = 0
        const harness = createWebToolHarness(runtime, {
          sessionId: 'browser-tab-binding-session',
          modelName: 'browser-tab-binding-test',
          browserUseService: {
            async ensureAutomationTab() {
              const id = ensuredTabIds[Math.min(ensureCallCount, ensuredTabIds.length - 1)]
              ensureCallCount += 1
              return { id }
            },
            async navigate() {
              return
            },
            async run(input) {
              runTabIds.push(input.tabId)
              return {
                action: input.action,
                page: { url: 'https://example.com/task' },
                result:
                  input.action === 'extract'
                    ? { extracted: 'done' }
                    : input.action === 'observe'
                      ? { actions: [] }
                      : input.action === 'act'
                        ? {
                            success: true,
                            message: 'done',
                            actionDescription: input.instruction,
                            actions: []
                          }
                        : null
              }
            }
          }
        })
        const first = await harness.invoke<BrowserUseResult>('browser_use', {
          action: 'navigate',
          instruction: '打开任务页',
          url: 'https://example.com/task'
        })
        const second = await harness.invoke<BrowserUseResult>('browser_use', {
          action: 'extract',
          instruction: '读取结果'
        })
        return { first, second, ensureCallCount, runTabIds }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.ensureCallCount === 1 &&
            result.runTabIds.length === 2 &&
            result.runTabIds.every((tabId) => tabId === 'automation-tab-a'),
          {
            name: 'browser-use-run-keeps-initial-tab-binding',
            message: '同一轮 Run 不应因 UI 活动标签变化而切换 browser_use 的目标标签。',
            data: result
          }
        )
      }
    })
  })
})
