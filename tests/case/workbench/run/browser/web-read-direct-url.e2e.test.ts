import { describe, it } from 'vitest'
import type { AiRunEvent, JsonValue } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  startLocalWorkbenchHttpServer,
  waitForWorkbenchAiRunCompletion
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'web-read-direct-url'
const WEB_READ_CODE = 'WEB_READ_DONE_731'

const isObjectRecord = (value: JsonValue | undefined): value is Record<string, JsonValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readToolInputString = (
  event: Extract<AiRunEvent, { type: 'tool_call_started' }>,
  key: string
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
        fixtures: ['tests/fixtures/workspace'],
        launchMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const server = await startLocalWorkbenchHttpServer(`<!doctype html>
          <title>Workbench Web Read Fixture</title>
          <main>
            <h1>网页读取测试资料</h1>
            <p>任务口令：${WEB_READ_CODE}</p>
            <p>这段内容只能通过读取网页正文获得，不需要点击、输入或提交表单。</p>
          </main>`)
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          try {
            const startedAtMs = Date.now()
            await sendWorkbenchMessage(
              page,
              `请读取这个网页 URL 的正文，并告诉我页面里的任务口令：${server.url}。请使用网页读取工具，不要使用浏览器点击操作。`
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
            const crawlStarts = toolStarts.filter((event) => event.toolName === 'web_crawl')
            const browserUseStarts = toolStarts.filter((event) => event.toolName === 'browser_use')
            const crawlResults = evidence.events.filter(
              (event): event is Extract<AiRunEvent, { type: 'tool_call_result' }> =>
                event.type === 'tool_call_result' && event.toolName === 'web_crawl'
            )

            return {
              finalAnswerText: evidence.finalAnswerText,
              eventTypes: evidence.events.map((event) => event.type),
              crawlUrls: crawlStarts.map((event) => readToolInputString(event, 'url')),
              usedBrowserUse: browserUseStarts.length > 0,
              crawlOk: crawlResults.some((event) => event.result?.ok === true),
              crawlErrors: crawlResults.map((event) => event.error || '').filter(Boolean)
            }
          } finally {
            await setup.workspace.cleanup()
            await server.close()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.eventTypes.includes('run_completed') &&
              result.crawlUrls.length > 0 &&
              result.crawlOk &&
              !result.usedBrowserUse &&
              result.finalAnswerText.includes(WEB_READ_CODE),
            {
              name: 'workbench-web-read-direct-url',
              message:
                '真实 e2e 应对用户直接提供的 URL 使用 web_crawl 读取正文，并回答网页里的唯一口令。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
