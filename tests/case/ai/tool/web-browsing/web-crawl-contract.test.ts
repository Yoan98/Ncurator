import http from 'node:http'
import { describe, it } from 'vitest'
import { createWebToolHarness } from '../../../../harness/backend/aiToolHarness'
import { createWebCrawlerService } from '../../../../harness/backend/webCrawlerTestUtils'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

type WebSearchFetchPayload = {
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
    }>
    external?: Array<{
      href?: string
      text?: string
      title?: string
    }>
  }
  error?: string
  statusCode?: number
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
  it('web-search-fetch-page-by-url', async () => {
    await runBackendCase({
      caseId: 'web-search-fetch-page-by-url',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['web-browsing'],
      description: '验证 web_search type=fetch 会返回该页面的标题、markdown、发布时间与后续链接。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const server = await createLocalServer()
        const webCrawlerService = await createWebCrawlerService()
        try {
          const harness = createWebToolHarness(runtime, {
            webCrawlerService
          })
          return await harness.invoke<WebSearchFetchPayload>('web_search', {
            type: 'fetch',
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
            result.links?.internal?.some((link) => link.href?.endsWith('/guide')),
          {
            name: 'web-search-fetch-returns-stable-page-fields',
            message:
              'web_search type=fetch 应返回 requestedUrl/finalUrl、标题、发布时间、markdown 和分组 links。',
            data: result
          }
        )
      }
    })
  })

  it('web-search-fetch-entry-page', async () => {
    await runBackendCase({
      caseId: 'web-search-fetch-entry-page',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['web-browsing'],
      description: '验证 web_search type=fetch 只读取该网页并保留页面链接。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const server = await createLocalServer()
        const webCrawlerService = await createWebCrawlerService()
        try {
          const harness = createWebToolHarness(runtime, {
            webCrawlerService
          })
          return await harness.invoke<WebSearchFetchPayload>('web_search', {
            type: 'fetch',
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
            result.links?.internal?.some((link) => link.href?.endsWith('/policy')),
          {
            name: 'web-search-fetch-reads-entry-page-without-auto-follow',
            message: 'web_search type=fetch 应读取该网页并返回页面链接，不自动跟进其他链接。',
            data: result
          }
        )
      }
    })
  })

  it('web-search-fetch-reuses-one-sidecar-for-multiple-pages', async () => {
    await runBackendCase({
      caseId: 'web-search-fetch-reuses-one-sidecar-for-multiple-pages',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['web-browsing'],
      description: '验证同一个 sidecar 和 Crawl4AI 实例可以连续抓取多个页面。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const server = await createLocalServer()
        const webCrawlerService = await createWebCrawlerService()
        try {
          const harness = createWebToolHarness(runtime, { webCrawlerService })
          const policy = await harness.invoke<WebSearchFetchPayload>('web_search', {
            type: 'fetch',
            url: `${server.baseUrl}/policy`
          })
          const guide = await harness.invoke<WebSearchFetchPayload>('web_search', {
            type: 'fetch',
            url: `${server.baseUrl}/guide`
          })
          return { policy, guide }
        } finally {
          await webCrawlerService.close()
          await server.close()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          !result.policy.error &&
            !result.guide.error &&
            result.policy.finalUrl?.endsWith('/policy') === true &&
            result.guide.finalUrl?.endsWith('/guide') === true &&
            result.policy.markdown?.includes('申报截止时间为 2026-09-30') === true &&
            result.guide.markdown?.includes('办理材料包括身份证') === true,
          {
            name: 'web-search-fetch-reuses-sidecar-without-serialization-failure',
            message: '连续抓取应复用同一个 sidecar，并且两个页面都返回可用正文。',
            data: result
          }
        )
      }
    })
  })

  it('web-search-fetch-http-failure', async () => {
    await runBackendCase({
      caseId: 'web-search-fetch-http-failure',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['web-browsing'],
      description: '验证 web_search type=fetch 遇到 HTTP 失败时会保留错误文本、最终 URL 和状态码。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const server = await createLocalServer()
        const webCrawlerService = await createWebCrawlerService()
        try {
          const harness = createWebToolHarness(runtime, {
            webCrawlerService
          })
          return await harness.invoke<WebSearchFetchPayload>('web_search', {
            type: 'fetch',
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
            name: 'web-search-fetch-preserves-http-failure-fields',
            message:
              'web_search type=fetch HTTP 失败时应保留错误文本、requestedUrl/finalUrl 和状态码。',
            data: result
          }
        )
      }
    })
  })

  it('web-search-fetch-returns-full-content-without-tool-level-truncation', async () => {
    await runBackendCase({
      caseId: 'web-search-fetch-returns-full-content-without-tool-level-truncation',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['web-browsing'],
      description:
        '验证 web_search type=fetch 不再在工具层对过大结果硬失败，完整正文直接返回，由 hand 层统一截断落盘。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const server = await createLocalServer()
        const webCrawlerService = await createWebCrawlerService()
        try {
          const harness = createWebToolHarness(runtime, {
            webCrawlerService
          })
          return await harness.invoke<WebSearchFetchPayload>('web_search', {
            type: 'fetch',
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
            !result.error,
          {
            name: 'web-search-fetch-returns-full-content',
            message: 'web_search type=fetch 结果过大时不再硬失败，完整正文由 hand 层统一截断落盘。',
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
        return await harness.invoke<{ error?: string }>('browser_use', {
          action: 'extract',
          tabId: 'missing-tab',
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
})
