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
        description: 'Follows a real multi-hop public-service website and answers an applicant in conversation.',
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
              userInput: `Starting at ${site.entryUrl}, tell me who can apply for the flexible-employment subsidy, the deadline, materials required, and how to submit online. Follow the relevant links only and do not change the website.`
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
