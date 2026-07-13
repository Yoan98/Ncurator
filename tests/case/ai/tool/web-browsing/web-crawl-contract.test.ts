import http from 'node:http'
import { describe, it } from 'vitest'
import { createWebToolHarness } from '../../../../harness/backend/aiToolHarness'
import { createWebCrawlerService } from '../../../../harness/backend/webCrawlerTestUtils'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

type WebCrawlResult = {
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

type WebSearchResult = {
  query?: string
  results?: Array<{
    rank?: number
    title?: string
    url?: string
    snippet?: string
  }>
  error?: string
}

type BrowserUseResult = {
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
  it('web-crawl-page-contract', async () => {
    await runBackendCase({
      caseId: 'web-crawl-page-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['web-browsing'],
      description: '验证 web_crawl 会返回当前最相关页面的标题、markdown、发布时间与后续链接。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const server = await createLocalServer()
        const webCrawlerService = createWebCrawlerService()
        try {
          const harness = createWebToolHarness(runtime, {
            webCrawlerService
          })
          return await harness.invoke<WebCrawlResult>('web_crawl', {
            url: `${server.baseUrl}/policy`,
            topic: '灵活就业补贴申报条件和办理指南'
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
            name: 'web-crawl-returns-stable-page-fields',
            message:
              'web_crawl 应返回 requestedUrl/finalUrl、标题、发布时间、markdown 和带评分的分组 links。',
            data: result
          }
        )
      }
    })
  })

  it('web-search-contract', async () => {
    await runBackendCase({
      caseId: 'web-search-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['web-browsing'],
      description: '验证 web_search 返回结构化候选网页结果。',
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
                  }
                ],
                raw: {
                  query: input.query,
                  results: []
                }
              }
            },
            async crawl() {
              throw new Error('crawl should not be called')
            },
            async close() {
              return
            }
          }
        })
        return await harness.invoke<WebSearchResult>('web_search', {
          query: '最近 DeepSeek 融资情况'
        })
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.query === '最近 DeepSeek 融资情况' &&
            Array.isArray(result.results) &&
            result.results.length === 1 &&
            result.results[0]?.rank === 1 &&
            result.results[0]?.url === 'https://example.com/deepseek-funding',
          {
            name: 'web-search-returns-structured-candidates',
            message: 'web_search 应返回 query 和结构化候选网页结果。',
            data: result
          }
        )
      }
    })
  })

  it('web-crawl-entry-page-contract', async () => {
    await runBackendCase({
      caseId: 'web-crawl-entry-page-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['web-browsing'],
      description: '验证 web_crawl 只读取输入 URL 对应网页，并保留页面链接。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const server = await createLocalServer()
        const webCrawlerService = createWebCrawlerService()
        try {
          const harness = createWebToolHarness(runtime, {
            webCrawlerService
          })
          return await harness.invoke<WebCrawlResult>('web_crawl', {
            url: `${server.baseUrl}/`,
            topic: '就业服务首页相关页面'
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
            name: 'web-crawl-reads-entry-page-without-auto-follow',
            message: 'web_crawl 应读取输入 URL 对应网页并返回页面链接，不再自动跟进其他链接。',
            data: result
          }
        )
      }
    })
  })

  it('web-crawl-http-failure-contract', async () => {
    await runBackendCase({
      caseId: 'web-crawl-http-failure-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['web-browsing'],
      description: '验证 web_crawl HTTP 失败时会保留错误文本、最终 URL 和状态码。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const server = await createLocalServer()
        const webCrawlerService = createWebCrawlerService()
        try {
          const harness = createWebToolHarness(runtime, {
            webCrawlerService
          })
          return await harness.invoke<WebCrawlResult>('web_crawl', {
            url: `${server.baseUrl}/missing`,
            topic: '缺失页面'
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
            name: 'web-crawl-preserves-http-failure-fields',
            message: 'web_crawl HTTP 失败时应保留错误文本、requestedUrl/finalUrl 和状态码。',
            data: result
          }
        )
      }
    })
  })

  it('web-crawl-too-large-contract', async () => {
    await runBackendCase({
      caseId: 'web-crawl-too-large-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['web-browsing'],
      description: '验证 web_crawl 结果过大时走统一 hand_tool_result_too_large 兜底。',
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
          return await harness.invoke<WebCrawlResult>('web_crawl', {
            url: `${server.baseUrl}/large`,
            topic: '超长补贴通知'
          })
        } finally {
          await webCrawlerService.close()
          await server.close()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.error === 'web_crawl result too large' &&
            result.reason === 'result_too_large' &&
            result.requestedUrl?.endsWith('/large') === true &&
            result.finalUrl?.endsWith('/large') === true &&
            result.decisionHint?.code === 'hand_tool_result_too_large',
          {
            name: 'web-crawl-too-large-uses-shared-decision-hint',
            message: 'web_crawl 结果过大时应走统一 hand_tool_result_too_large 兜底。',
            data: result
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
