import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv } from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { createWebCrawlerService } from '../../../../harness/backend/webCrawlerTestUtils'
import { createMultiHopCrossDomainWebCrawlSite } from '../../../../harness/backend/webCrawlLiveTestSites'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const normalizeUrl = (value: string): string => value.replace(/\/$/, '')

describe('ai human live backend', () => {
  it('human-web-search-by-url-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-web-search-by-url-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '用户给指定地址，AI 直接调用 web_search(type=fetch) 读取该页并回答。',
        fixtures: [],
        runMode: 'single',
        runtimeModelName: loadLiveLlmConfigFromEnv().model_name,
        execute: async (runtime) => {
          const site = await createMultiHopCrossDomainWebCrawlSite()
          const webCrawlerService = await createWebCrawlerService()
          try {
            const output = await createHumanTestRunner(runtime, {
              webCrawlerService
            }).run({
              taskId: runtime.taskId,
              userInput: `请阅读这个页面并告诉我：灵活就业补贴的申请对象是谁、申报截止日期是哪天。页面地址：${site.noticeUrl}`
            })
            return { output, site, events: runtime.eventCollector.snapshot() }
          } finally {
            await webCrawlerService.close()
            await site.close()
          }
        },
        assert: async (result, runtime) => {
          const starts = filterAiRunEventsByType(result.events, 'tool_call_started').filter(
            (event) => event.toolName === 'web_search'
          )
          const urlCalls = starts
            .filter((event) => event.input?.type === 'fetch')
            .map((event) => String(event.input?.url || ''))
          const results = filterAiRunEventsByType(result.events, 'tool_call_result').filter(
            (event) => event.toolName === 'web_search' && event.result?.ok === true
          )
          runtime.assertThat(
            result.output.status === 'completed' &&
              urlCalls.some(
                (url) => normalizeUrl(url) === normalizeUrl(result.site.noticeUrl)
              ) &&
              results.some((event) => {
                const data = event.result?.data
                if (!data || typeof data !== 'object' || Array.isArray(data)) return false
                const finalUrl = String((data as { finalUrl?: unknown }).finalUrl || '')
                return normalizeUrl(finalUrl) === normalizeUrl(result.site.noticeUrl)
              }) &&
              result.output.deliveryMarkdown.includes('杭州市灵活就业人员') &&
              result.output.deliveryMarkdown.includes('2026') &&
              /9\s*月\s*30\s*日/.test(result.output.deliveryMarkdown),
            {
              name: 'human-live-web-search-by-url-answers-from-given-address',
              message: '用户给指定地址时 AI 应直接 web_search(type=fetch) 读取该页并基于正文回答。',
              data: { urlCalls, delivery: result.output.deliveryMarkdown }
            }
          )
        }
      })
    })
  })
})
