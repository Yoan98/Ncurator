import { describe, it } from 'vitest'
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import type { AiRunEvent, JsonValue } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  assertWorkbenchLocalSearchResultsPanelHidden,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForWorkbenchAiRunCompletion
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'web-read-direct-url'

const isObjectRecord = (value: JsonValue | undefined): value is Record<string, JsonValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readWebSearchInput = (
  event: Extract<AiRunEvent, { type: 'tool_call_started' }>,
  key: 'query' | 'url' | 'type'
): string => {
  const input = event.input as JsonValue
  if (!isObjectRecord(input)) return ''
  const value = input[key]
  return typeof value === 'string' ? value : ''
}

describe('workbench run e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'run',
        groups: ['browser'],
        description: '真实 AI 读取用户直接给出的 URL 正文，并从网页正文中回答唯一口令。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const webReadCode = `WEB_READ_${randomUUID()}`
          let bodyRequests = 0
          const server = http.createServer((request, response) => {
            response.setHeader('cache-control', 'no-store')
            if (request.url === '/body') {
              bodyRequests += 1
              response.setHeader('content-type', 'application/json; charset=utf-8')
              response.end(
                JSON.stringify({
                  title: '网页读取测试资料',
                  paragraphs: [
                    `本页的任务口令：${webReadCode}。`,
                    ...Array.from(
                      { length: 8 },
                      () =>
                        '这是一份需要执行网页脚本后才能读取的公开测试资料。浏览器请求正文接口后，将文章段落展示在页面中，供网页读取工具提取。'
                    )
                  ]
                })
              )
              return
            }
            response.setHeader('content-type', 'text/html; charset=utf-8')
            response.end(`<!doctype html><html><head><title>网页读取测试资料</title></head>
              <body><main id="facts"></main><script>
              fetch('/body').then(response => response.json()).then(data => {
                const article = document.createElement('article');
                const heading = document.createElement('h1');
                heading.textContent = data.title;
                article.append(heading);
                for (const text of data.paragraphs) {
                  const paragraph = document.createElement('p');
                  paragraph.textContent = text;
                  article.append(paragraph);
                }
                document.querySelector('#facts').append(article);
              });
              </script></body></html>`)
          })
          await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
          const address = server.address()
          if (!address || typeof address === 'string')
            throw new Error('missing test server address')
          const url = `http://127.0.0.1:${address.port}/`
          runtime.registerResource({
            name: 'web-read-http-server',
            phase: 'before-app-close',
            dispose: async () => {
              server.closeAllConnections()
              await new Promise<void>((resolve) => server.close(() => resolve()))
            }
          })
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            workspaceContents: 'empty'
          })
          const startedAtMs = Date.now()
          await sendWorkbenchMessage(
            page,
            `请读取这个网页 URL 的正文，并告诉我页面里的任务口令：${url}。请使用网页读取工具，不要使用浏览器点击操作。`
          )
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            setup.env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.85)

          const toolStarts = evidence.events.filter(
            (event): event is Extract<AiRunEvent, { type: 'tool_call_started' }> =>
              event.type === 'tool_call_started'
          )
          const crawlStarts = toolStarts.filter((event) => event.toolName === 'web_search')
          const browserUseStarts = toolStarts.filter((event) => event.toolName === 'browser_use')
          const crawlResults = evidence.events.filter(
            (event): event is Extract<AiRunEvent, { type: 'tool_call_result' }> =>
              event.type === 'tool_call_result' && event.toolName === 'web_search'
          )
          const fetchCallIds = new Set(
            crawlStarts
              .filter(
                (event) =>
                  readWebSearchInput(event, 'type') === 'fetch' &&
                  readWebSearchInput(event, 'url') === url
              )
              .map((event) => event.toolCallId)
          )

          return {
            finalAnswerText: evidence.finalAnswerText,
            eventTypes: evidence.events.map((event) => event.type),
            crawlUrls: crawlStarts
              .filter((event) => readWebSearchInput(event, 'type') === 'fetch')
              .map((event) => readWebSearchInput(event, 'url')),
            usedBrowserUse: browserUseStarts.length > 0,
            crawlOk: crawlResults.some(
              (event) =>
                fetchCallIds.has(event.toolCallId) &&
                event.result?.ok === true &&
                isObjectRecord(event.result.data) &&
                typeof event.result.data.markdown === 'string' &&
                event.result.data.markdown.includes(webReadCode)
            ),
            bodyRequests,
            crawlErrors: crawlResults.map((event) => event.error || '').filter(Boolean)
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.eventTypes.includes('run_completed') &&
              result.crawlUrls.length > 0 &&
              result.crawlOk &&
              result.bodyRequests > 0 &&
              !result.usedBrowserUse &&
              result.finalAnswerText.length > 0,
            {
              name: 'workbench-web-read-direct-url',
              message:
                '真实 e2e 应对用户直接提供的 URL 使用 web_search 读取正文，并回答网页里的唯一口令。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
          await assertWorkbenchLocalSearchResultsPanelHidden(runtime.page)
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
