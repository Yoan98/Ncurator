import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv } from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { createWebCrawlerService } from '../../../../harness/backend/webCrawlerTestUtils'
import { createMultiHopCrossDomainWebCrawlSite } from '../../../../harness/backend/webCrawlLiveTestSites'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const normalizeUrl = (value: string): string => value.replace(/\/$/, '')

describe('ai human live backend', () => {
  it('human-web-crawl-multi-hop-cross-domain-reading-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-web-crawl-multi-hop-cross-domain-reading-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '跟随真实多跳政务网站并以对话方式答复申请者。',
        fixtures: [],
        runMode: 'single',
        runtimeModelName: loadLiveLlmConfigFromEnv().model_name,
        execute: async (runtime) => {
          const site = await createMultiHopCrossDomainWebCrawlSite()
          const webCrawlerService = createWebCrawlerService()
          try {
            const output = await createHumanTestRunner(runtime, {
              webCrawlerService
            }).run({
              taskId: runtime.taskId,
              userInput: `从 ${site.entryUrl} 开始，告诉我谁可以申请灵活就业补贴、截止日期、所需材料以及如何在线提交。只跟随相关链接，不要修改网站。`
            })
            return { output, site, events: runtime.eventCollector.snapshot() }
          } finally {
            await webCrawlerService.close()
            await site.close()
          }
        },
        assert: async (result, runtime) => {
          const crawlStarts = filterAiRunEventsByType(result.events, 'tool_call_started')
            .filter((event) => event.toolName === 'web_crawl')
            .map((event) => String(event.input.url || ''))
          const crawlResults = filterAiRunEventsByType(result.events, 'tool_call_result').filter(
            (event) => event.toolName === 'web_crawl' && event.result?.ok === true
          )
          runtime.assertThat(
            result.output.status === 'completed' &&
              crawlStarts.length >= 4 &&
              crawlStarts.some((url) => normalizeUrl(url) === normalizeUrl(result.site.entryUrl)) &&
              crawlResults.length >= 4,
            {
              name: 'human-live-web-crawl-multi-hop-answers-from-real-sources',
              message: 'The live model must follow the real multi-hop path before answering the user.',
              data: { crawlStarts }
            }
          )
        }
      })
    })
  })
})
