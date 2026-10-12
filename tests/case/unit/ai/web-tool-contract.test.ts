import { renderWebSearchModelResult } from '../../../../src/main/services/ai/human/shared/modelToolResultRenderers'
import { renderBrowserUseModelResult } from '../../../../src/main/services/ai/human/shared/modelToolResultRenderers'
import { renderBrowserUseModelError } from '../../../../src/main/services/ai/human/shared/modelToolResultRenderers'
import { describe, expect } from 'vitest'
import { it } from 'vitest'
import type { AiRunContext, BrowserUseRunRequest } from '../../../../src/main/services/ai/types'
import type { JsonObject } from '../../../../src/shared/types'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { webToolFamily } from '../../../../src/main/services/ai/human/tools/web'

const createUnitWebTools = (
  input: Pick<AiRunContext, 'webCrawlerService' | 'browserUseService'> & {
    partnerId?: string
    modelName?: string
  }
) => {
  const ctx: Partial<AiRunContext> = {
    ...input,
    partnerId: input.partnerId || 'unit-partner',
    runId: 'unit-run',
    checkCancelled: () => {},
    sendEvent: () => {},
    getLlmConfig: async () => ({
      id: 'unit-model',
      name: 'Unit model',
      providerKind: 'openai-compatible',
      base_url: 'https://example.com/v1',
      model_name: 'unit-model',
      api_key: 'test-key'
    })
  }
  const tools = webToolFamily.buildTools({
    ctx: ctx as AiRunContext,
    runId: 'unit-run',
    partnerId: 'unit-partner',
    taskId: 'unit-task',
    cache: createHumanRuntimeCache()
  })
  return {
    invoke: async <T>(name: string, input: JsonObject): Promise<T> => {
      const tool = tools.find((item) => item.name === name)
      if (!tool) throw new Error('tool missing: ' + name)
      return (await tool.invoke(input)) as T
    }
  }
}

type WebSearchSearchPayload = {
  query: string
  results: Array<{ rank: number; title: string; url: string; snippet?: string }>
}

describe('web tool adapter contracts', () => {
  it('web-search-returns-serp-by-search-type', async () => {
    const result = await (async () => {
      const harness = createUnitWebTools({
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
    })()

    expect(
      result.query === '最近 DeepSeek 融资情况' &&
        result.results.length === 2 &&
        result.results[0]?.url === 'https://example.com/deepseek-funding' &&
        result.results[0]?.snippet?.includes('510 亿元') &&
        !('markdown' in result)
    ).toBeTruthy()
  })
  it('browser-use-navigate-returns-tab-for-follow-up', async () => {
    const result = await (async () => {
      const runTabIds: string[] = []
      let createTabCount = 0
      const harness = createUnitWebTools({
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
    })()

    expect(
      result.first.tabId === 'automation-tab-a' &&
        result.second.tabId === 'automation-tab-a' &&
        result.createTabCount === 0 &&
        result.runTabIds.length === 2 &&
        result.runTabIds.every((tabId) => tabId === 'automation-tab-a')
    ).toBeTruthy()
  })
  it('browser-use-act-text-and-instruction-contract', async () => {
    const result = await (async () => {
      const capturedRuns: BrowserUseRunRequest[] = []
      const harness = createUnitWebTools({
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
            throw new Error(`Unhandled action: ${input.action}`)
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
    })()

    const fillRun = result.capturedRuns.find(
      (run): run is Extract<BrowserUseRunRequest, { action: 'act' }> =>
        run.action === 'act' && run.stagehandAction.method === 'fill'
    )
    const clickRun = result.capturedRuns.find(
      (run): run is Extract<BrowserUseRunRequest, { action: 'act' }> =>
        run.action === 'act' && run.stagehandAction.method === 'click'
    )
    const instructionRun = result.capturedRuns.find((run) => run.action === 'act_instruction')

    expect(
      fillRun &&
        fillRun.stagehandAction.arguments.length === 1 &&
        fillRun.stagehandAction.arguments[0] === '我的长篇输入内容' &&
        clickRun &&
        clickRun.stagehandAction.arguments.length === 0 &&
        instructionRun &&
        instructionRun.instruction === '点击左上角主页' &&
        result.fillActResult.executed.arguments[0] === '我的长篇输入内容' &&
        result.instructionResult.action === 'act_instruction'
    ).toBeTruthy()
  })
})

describe('tool result data fidelity', () => {
  it('preserves web_search search results data', () => {
    const rendered = renderWebSearchModelResult({
      toolName: 'web_search',
      args: { type: 'search', query: 'DeepSeek funding' },
      data: {
        query: 'DeepSeek funding',
        results: [
          {
            rank: 1,
            title: 'Funding news',
            url: 'https://example.com/news',
            snippet: 'Raised 510 billion yuan.'
          }
        ]
      }
    })

    expect(rendered).toContain('DeepSeek funding')
    expect(rendered).toContain('Funding news')
    expect(rendered).toContain('Raised 510 billion yuan.')
  })

  it('preserves web_search fetch results with untrusted markdown data', () => {
    const rendered = renderWebSearchModelResult({
      toolName: 'web_search',
      args: { type: 'fetch', url: 'https://example.com/news' },
      data: {
        requestedUrl: 'https://example.com/news',
        finalUrl: 'https://example.com/news',
        title: 'Funding news',
        markdown: '# Funding\n\nRaised 510 billion yuan.',
        links: { internal: [], external: [] }
      }
    })

    expect(rendered).toContain('# Funding')
    expect(rendered).toContain('510 billion yuan')
  })

  it('preserves browser_use act success data', () => {
    const rendered = renderBrowserUseModelResult({
      toolName: 'browser_use',
      args: { action: 'act', tabId: 'tab_a1', actionId: 'obs_1' },
      data: {
        action: 'act',
        tabId: 'tab_a1',
        page: { url: 'https://example.com/form', title: 'Contact Form' },
        message: 'Action [click] performed successfully on selector: xpath=//button',
        actionDescription: 'Click Submit',
        executed: {
          actionId: 'obs_1',
          method: 'click',
          description: 'Click Submit',
          arguments: [],
          selector: 'xpath=//button'
        }
      }
    })

    expect(rendered).toContain('tab_a1')
    expect(rendered).toContain('https://example.com/form')
    expect(rendered).toContain('Action [click] performed successfully')
    expect(rendered).toContain('Click Submit')
    expect(rendered).toContain('obs_1')
    expect(rendered).toContain('selector: xpath=//button')
  })

  it('preserves browser_use act failure with page context data', () => {
    const rendered = renderBrowserUseModelError({
      toolName: 'browser_use',
      args: { action: 'act', tabId: 'tab_a1', actionId: 'obs_2' },
      data: {
        action: 'act',
        tabId: 'tab_a1',
        page: { url: 'https://example.com/form', title: 'Contact Form' },
        message: 'Element not found',
        actionDescription: 'Click Confirm',
        error: 'Element not found',
        executed: {
          actionId: 'obs_2',
          method: 'click',
          description: 'Click Confirm',
          arguments: [],
          selector: 'xpath=//missing'
        }
      }
    })

    expect(rendered).toContain('tab_a1')
    expect(rendered).toContain('https://example.com/form')
    expect(rendered).toContain('Element not found')
    expect(rendered).toContain('Click Confirm')
  })

  it('preserves browser_use observe actions data', () => {
    const rendered = renderBrowserUseModelResult({
      toolName: 'browser_use',
      args: { action: 'observe', tabId: 'tab_a1', instruction: 'find logout' },
      data: {
        action: 'observe',
        tabId: 'tab_a1',
        page: { url: 'https://example.com', title: 'Home' },
        actions: [
          {
            actionId: 'obs_a',
            method: 'hover',
            description: '消息图标',
            arguments: [],
            selector: 'xpath=//button[1]'
          }
        ]
      }
    })

    expect(rendered).toContain('tab_a1')
    expect(rendered).toContain('obs_a')
    expect(rendered).toContain('xpath=//button[1]')
    expect(rendered).toContain('消息图标')
  })

  it('preserves browser_use scroll completed data', () => {
    const rendered = renderBrowserUseModelResult({
      toolName: 'browser_use',
      args: { action: 'scroll', tabId: 'tab_a1', direction: 'down' },
      data: {
        action: 'scroll',
        tabId: 'tab_a1',
        page: { url: 'https://example.com', title: 'Home' },
        message: 'Scrolled 80% down (720px)',
        scrolledPixels: 720
      }
    })

    expect(rendered).toContain('tab_a1')
    expect(rendered).toContain('https://example.com')
    expect(rendered).toContain('Scrolled 80% down (720px)')
  })

  it('preserves browser_use navigate success data', () => {
    const rendered = renderBrowserUseModelResult({
      toolName: 'browser_use',
      args: { action: 'navigate', url: 'https://epub.cnipa.gov.cn/' },
      data: {
        action: 'navigate',
        tabId: 'tab_nav',
        page: { url: 'https://epub.cnipa.gov.cn/', title: '中国专利公布公告' }
      }
    })

    expect(rendered).toContain('tab_nav')
    expect(rendered).toContain('中国专利公布公告')
    expect(rendered).toContain('https://epub.cnipa.gov.cn/')
  })

  it('preserves browser_use navigate failure with error and tab id data', () => {
    const rendered = renderBrowserUseModelError({
      toolName: 'browser_use',
      args: { action: 'navigate', url: 'epub.cnipa.gov.cn' },
      data: {
        action: 'navigate',
        tabId: 'tab_nav',
        error:
          '无法访问此站点（ERR_CONNECTION_CLOSED）。https://epub.cnipa.gov.cn/ 连接被服务器断开。'
      }
    })

    expect(rendered).toContain('无法访问此站点（ERR_CONNECTION_CLOSED）')
    expect(rendered).toContain('tab_nav')
  })
})
