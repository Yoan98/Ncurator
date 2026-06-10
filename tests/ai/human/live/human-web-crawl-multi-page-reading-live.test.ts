import http from 'node:http'
import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { createMockWebCrawlerService } from '../../../harness/backend/webCrawlerTestUtils'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const createLocalServer = async (): Promise<{
  baseUrl: string
  close: () => Promise<void>
}> => {
  const server = http.createServer((request, response) => {
    const currentPath = request.url || '/'
    if (currentPath === '/notice') {
      response.statusCode = 200
      response.end(`
        <html>
          <head>
            <title>灵活就业补贴申报通知</title>
            <meta property="article:published_time" content="2026-06-10" />
          </head>
          <body>
            <main>
              灵活就业人员可申请本次补贴。申报截止时间为 2026-09-30。
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
              办理材料包括身份证、社保缴费证明和申请表。支持在线提交申请。
            </main>
            <a href="/notice">查看申报通知</a>
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
          <main>本页汇总通知公告和办事指南。</main>
          <a href="/notice">灵活就业补贴申报通知</a>
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

describe('ai human live backend', () => {
  it('human-web-crawl-multi-page-reading-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-web-crawl-multi-page-reading-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '验证 live 模式下 human 会围绕网页诉求自主多次调用 web_crawl，并基于多个网页整理结果。',
        fixtures: [],
        runMode: 'single',
        runtimeModelName: hasLiveLlmConfigInEnv()
          ? loadLiveLlmConfigFromEnv().model_name
          : null,
        execute: async (runtime) => {
          if (!hasLiveLlmConfigInEnv()) {
            return {
              skipped: true,
              output: null,
              events: []
            }
          }

          const server = await createLocalServer()
          const webCrawlerService = createMockWebCrawlerService()
          try {
            await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv())
            const runner = createHumanTestRunner(runtime, {
              webCrawlerService
            })
            const output = await runner.run({
              taskId: runtime.taskId,
              userInput: `帮我基于这个网站整理灵活就业补贴的申请说明：${server.baseUrl}/ 。我需要知道谁可以申请、需要哪些材料、截止时间和办理方式。信息如果分散在不同网页，你自己继续找；网页没写的不要补。`
            })
            return {
              skipped: false,
              output,
              events: runtime.eventCollector.snapshot()
            }
          } finally {
            await webCrawlerService.close()
            await server.close()
          }
        },
        assert: async (result, runtime) => {
          if (result.skipped) {
            runtime.assertThat(true, {
              name: 'live-config-not-provided',
              message: '未提供 live 模型配置，已跳过 human web crawl live case。'
            })
            return
          }

          const toolStarts = filterAiRunEventsByType(result.events, 'tool_call_started').filter(
            (event) => event.toolName === 'web_crawl'
          )
          const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result').filter(
            (event) => event.toolName === 'web_crawl'
          )
          const deliveryText = String(result.output?.deliveryMarkdown || '')
          const startedUrls = toolStarts
            .map((event) => event.input.url)
            .filter((value): value is string => typeof value === 'string')

          runtime.assertThat(
            result.output?.status === 'completed'
              && toolStarts.length >= 2
              && toolResults.length >= 2
              && startedUrls.some((url) => url.endsWith('/'))
              && /(灵活就业人员|可申请本次补贴)/.test(deliveryText)
              && /(身份证|社保缴费证明|申请表)/.test(deliveryText)
              && /(2026-09-30|2026 年 9 月 30 日)/.test(deliveryText)
              && /(在线提交申请|在线提交)/.test(deliveryText),
            {
              name: 'human-live-web-crawl-multi-page-reading',
              message: 'live human 应至少两次调用 web_crawl，并基于多个网页整理申请对象、材料、截止时间和办理方式。',
              data: {
                startedUrls,
                toolResultCount: toolResults.length,
                deliveryMarkdown: result.output?.deliveryMarkdown
              }
            }
          )
        }
      })
    })
  })
})
