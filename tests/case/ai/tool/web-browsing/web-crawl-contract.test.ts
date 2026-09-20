import http from 'node:http'
import { describe, it } from 'vitest'
import { createWebToolHarness } from '../../../../harness/backend/aiToolHarness'
import { TOOL_REAL_LLM_CONFIG_ID } from '../../../../harness/backend/llmConfig'
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

type WebSearchSearchPayload = {
  query: string
  results: Array<{
    rank: number
    title: string
    url: string
    snippet?: string
  }>
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

  it('web-search-returns-serp-by-search-type', async () => {
    await runBackendCase({
      caseId: 'web-search-returns-serp-by-search-type',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['web-browsing'],
      description: '验证 web_search type=search 只返回 SERP 候选，不抓取正文。',
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
            async crawl() {
              throw new Error('crawl should not be called for type=search')
            },
            async close() {
              return
            }
          }
        })
        return await harness.invoke<WebSearchSearchPayload>('web_search', {
          type: 'search',
          query: '最近 DeepSeek 融资情况'
        })
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.query === '最近 DeepSeek 融资情况' &&
            result.results.length === 2 &&
            result.results[0]?.url === 'https://example.com/deepseek-funding' &&
            result.results[0]?.snippet?.includes('510 亿元') &&
            !('markdown' in result),
          {
            name: 'web-search-returns-serp-only',
            message: 'web_search type=search 应只返回 query 与 rank/title/url/snippet 列表。',
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
        return await harness.invoke<BrowserUseResult>('browser_use', {
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

  it('browser-use-navigate-returns-tab-for-follow-up', async () => {
    await runBackendCase({
      caseId: 'browser-use-navigate-returns-tab-for-follow-up',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['web-browsing'],
      description: '验证 navigate 返回 tabId，后续 observe/extract 必须使用该 tabId。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await runtime.seedLlmConfig({
          id: TOOL_REAL_LLM_CONFIG_ID,
          name: 'Browser tab binding test model',
          providerKind: 'openai-compatible',
          base_url: 'https://example.com/v1',
          model_name: 'browser-tab-binding-test',
          api_key: 'test-key'
        })
        const runTabIds: string[] = []
        let createTabCount = 0
        const harness = createWebToolHarness(runtime, {
          partnerId: 'browser-tab-binding-session',
          modelName: 'browser-tab-binding-test',
          browserUseService: {
            async createTab() {
              createTabCount += 1
              return { id: 'automation-tab-a' }
            },
            async ensureAutomationTab() {
              return { id: 'should-not-use' }
            },
            getActiveTabId() {
              return 'automation-tab-a'
            },
            listTabs() {
              return [{ id: 'automation-tab-a', title: 'Task', url: 'https://example.com/task' }]
            },
            async navigate() {
              return
            },
            async run(input) {
              if (input.action === 'list_tabs') {
                return {
                  action: 'list_tabs',
                  tabs: [
                    {
                      tabId: 'automation-tab-a',
                      title: 'Task',
                      url: 'https://example.com/task',
                      active: true
                    }
                  ],
                  result: null
                }
              }
              if (input.action === 'navigate') {
                const tabId = input.tabId || 'automation-tab-a'
                runTabIds.push(tabId)
                return {
                  action: 'navigate',
                  tabId,
                  page: { url: 'https://example.com/task' },
                  result: null
                }
              }
              runTabIds.push(input.tabId)
              if (input.action === 'extract') {
                return {
                  action: 'extract',
                  tabId: input.tabId,
                  page: { url: 'https://example.com/task' },
                  result: { extracted: 'done' }
                }
              }
              if (input.action === 'observe') {
                return {
                  action: 'observe',
                  tabId: input.tabId,
                  page: { url: 'https://example.com/task' },
                  result: { actions: [] }
                }
              }
              if (input.action === 'act') {
                return {
                  action: 'act',
                  tabId: input.tabId,
                  page: { url: 'https://example.com/task' },
                  result: {
                    success: true,
                    message: 'done',
                    actionDescription: input.stagehandAction.description,
                    executed: {
                      actionId: input.actionId,
                      ...input.stagehandAction
                    }
                  }
                }
              }
              if (input.action === 'screenshot') {
                return {
                  action: 'screenshot',
                  tabId: input.tabId,
                  page: { url: 'https://example.com/task' },
                  result: { path: input.screenshotPath }
                }
              }
              return {
                action: 'scroll',
                tabId: input.tabId,
                page: { url: 'https://example.com/task' },
                result: { message: 'Scrolled 80% down', scrolledPixels: 600 }
              }
            }
          }
        })
        const first = await harness.invoke<{
          action: string
          tabId: string
          page: { url: string }
        }>('browser_use', {
          action: 'navigate',
          url: 'https://example.com/task'
        })
        const second = await harness.invoke<{
          action: string
          tabId: string
          content: string
        }>('browser_use', {
          action: 'extract',
          tabId: first.tabId,
          instruction: '读取结果'
        })
        return { first, second, createTabCount, runTabIds }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.first.tabId === 'automation-tab-a' &&
            result.second.tabId === 'automation-tab-a' &&
            result.createTabCount === 0 &&
            result.runTabIds.length === 2 &&
            result.runTabIds.every((tabId) => tabId === 'automation-tab-a'),
          {
            name: 'browser-use-follow-up-uses-navigate-tab-id',
            message: '后续 browser_use 调用应显式使用 navigate 返回的 tabId。',
            data: result
          }
        )
      }
    })
  })

  it('browser-use-act-text-and-instruction-contract', async () => {
    await runBackendCase({
      caseId: 'browser-use-act-text-and-instruction-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['web-browsing'],
      description: '验证 browser_use act 支持文本注入与输入防爆，并支持 act_instruction 指令驱动。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await runtime.seedLlmConfig({
          id: TOOL_REAL_LLM_CONFIG_ID,
          name: 'Browser act test model',
          providerKind: 'openai-compatible',
          base_url: 'https://example.com/v1',
          model_name: 'browser-act-test',
          api_key: 'test-key'
        })
        const capturedRuns: any[] = []
        const harness = createWebToolHarness(runtime, {
          partnerId: 'browser-act-session',
          modelName: 'browser-act-test',
          browserUseService: {
            async createTab() {
              return { id: 'tab-act' }
            },
            async ensureAutomationTab() {
              return { id: 'tab-act' }
            },
            getActiveTabId() {
              return 'tab-act'
            },
            listTabs() {
              return [{ id: 'tab-act', title: 'Act Test', url: 'https://example.com/form' }]
            },
            async navigate() {
              return
            },
            async run(input) {
              capturedRuns.push(input)
              if (input.action === 'observe') {
                return {
                  action: 'observe',
                  tabId: input.tabId,
                  page: { url: 'https://example.com/form' },
                  result: {
                    actions: [
                      {
                        description: 'Input feedback note',
                        method: 'fill',
                        arguments: [],
                        selector: '#note-input'
                      },
                      {
                        description: 'Click submit button',
                        method: 'click',
                        arguments: [],
                        selector: '#submit-btn'
                      }
                    ]
                  }
                }
              }
              if (input.action === 'act') {
                return {
                  action: 'act',
                  tabId: input.tabId,
                  page: { url: 'https://example.com/form' },
                  result: {
                    success: true,
                    message: 'action performed',
                    actionDescription: input.stagehandAction.description,
                    executed: {
                      actionId: input.actionId,
                      ...input.stagehandAction
                    }
                  }
                }
              }
              if (input.action === 'act_instruction') {
                return {
                  action: 'act_instruction',
                  tabId: input.tabId,
                  page: { url: 'https://example.com/form' },
                  result: {
                    success: true,
                    message: `Instruction performed: ${input.instruction}`,
                    actionDescription: input.instruction
                  }
                }
              }
              throw new Error(`Unhandled action: ${(input as any).action}`)
            }
          }
        })

        // 1. observe 得到 actionId
        const observeResult = await harness.invoke<{
          action: string
          tabId: string
          actions: Array<{ actionId: string; method: string; description: string }>
        }>('browser_use', {
          action: 'observe',
          tabId: 'tab-act',
          instruction: '寻找表单'
        })
        const fillCandidate = observeResult.actions.find((item) => item.method === 'fill')
        const clickCandidate = observeResult.actions.find((item) => item.method === 'click')
        if (!fillCandidate || !clickCandidate) {
          throw new Error('observe candidates not found')
        }

        // 2. 对 fill 动作执行 act，传入 text
        const fillActResult = await harness.invoke<{
          action: string
          message: string
          executed: { arguments: string[] }
        }>('browser_use', {
          action: 'act',
          tabId: 'tab-act',
          actionId: fillCandidate.actionId,
          text: '我的长篇输入内容'
        })

        // 3. 对 click 动作执行 act，误传入 text，验证 arguments 不会被污染
        const clickActResult = await harness.invoke<{
          action: string
          message: string
          executed: { arguments: string[] }
        }>('browser_use', {
          action: 'act',
          tabId: 'tab-act',
          actionId: clickCandidate.actionId,
          text: '不该传给click的内容'
        })

        // 4. 执行 act_instruction
        const instructionResult = await harness.invoke<{
          action: string
          message: string
          actionDescription: string
        }>('browser_use', {
          action: 'act_instruction',
          tabId: 'tab-act',
          instruction: '点击左上角主页'
        })

        return {
          observeResult,
          fillActResult,
          clickActResult,
          instructionResult,
          capturedRuns
        }
      },
      assert: async (result, runtime) => {
        const fillRun = result.capturedRuns.find(
          (run) => run.action === 'act' && run.stagehandAction.method === 'fill'
        )
        const clickRun = result.capturedRuns.find(
          (run) => run.action === 'act' && run.stagehandAction.method === 'click'
        )
        const instructionRun = result.capturedRuns.find(
          (run) => run.action === 'act_instruction'
        )

        runtime.assertThat(
          fillRun &&
            fillRun.stagehandAction.arguments.length === 1 &&
            fillRun.stagehandAction.arguments[0] === '我的长篇输入内容' &&
            clickRun &&
            clickRun.stagehandAction.arguments.length === 0 &&
            instructionRun &&
            instructionRun.instruction === '点击左上角主页' &&
            result.fillActResult.executed.arguments[0] === '我的长篇输入内容' &&
            result.instructionResult.action === 'act_instruction',
          {
            name: 'browser-use-act-text-and-instruction-valid',
            message: 'fill 动作正确覆盖 text，click 动作正确过滤 text，act_instruction 正确按指令派发。',
            data: { fillRun, clickRun, instructionRun, result }
          }
        )
      }
    })
  })
})
