import { describe, it } from 'vitest'
import {
  loadLiveLlmConfigFromEnv,
  hasLiveLlmConfigInEnv
} from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { createWebCrawlerService } from '../../../../harness/backend/webCrawlerTestUtils'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { createMultiHopCrossDomainWebCrawlSite } from '../../../../harness/backend/webCrawlLiveTestSites'
import { buildHumanWebCrawlMultiHopCrossDomainUserInput } from '../../../../harness/backend/aiLiveTestData'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'
import type { JsonObject, JsonValue } from '../../../../../src/shared/types'

const normalizeUrl = (value: string): string => value.replace(/\/$/, '')

const isJsonObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readResultFinalUrl = (event: { result?: { data?: JsonValue } }): string | null => {
  const data = event.result?.data
  if (!isJsonObject(data) || typeof data.finalUrl !== 'string') {
    return null
  }
  return data.finalUrl
}

const includesUrl = (urls: string[], expectedUrl: string): boolean =>
  urls.some((url) => normalizeUrl(url) === normalizeUrl(expectedUrl))

describe('ai human live backend', () => {
  it('human-web-crawl-multi-hop-cross-domain-reading-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-web-crawl-multi-hop-cross-domain-reading-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description:
          '验证 live 模式下 human 会围绕入口网址持续多次调用 web_crawl，跨域并多跳整理灵活就业补贴申请说明。',
        fixtures: [],
        runMode: 'single',
        runtimeModelName: hasLiveLlmConfigInEnv() ? loadLiveLlmConfigFromEnv().model_name : null,
        execute: async (runtime) => {
          if (!hasLiveLlmConfigInEnv()) {
            return {
              skipped: true,
              output: null,
              site: null,
              events: []
            }
          }

          const site = await createMultiHopCrossDomainWebCrawlSite()
          const webCrawlerService = createWebCrawlerService()
          try {
            await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv())
            const runner = createHumanTestRunner(runtime, {
              allowedToolNames: ['web_crawl'],
              webCrawlerService
            })
            const output = await runner.run({
              taskId: runtime.taskId,
              userInput: buildHumanWebCrawlMultiHopCrossDomainUserInput(site.entryUrl)
            })
            return {
              skipped: false,
              output,
              site,
              events: runtime.eventCollector.snapshot()
            }
          } finally {
            await webCrawlerService.close()
            await site.close()
          }
        },
        assert: async (result, runtime) => {
          if (result.skipped || !result.site) {
            runtime.assertThat(true, {
              name: 'live-config-not-provided',
              message:
                '未提供 live 模型配置，已跳过 human web crawl multi-hop cross-domain live case。'
            })
            return
          }

          const toolStarts = filterAiRunEventsByType(result.events, 'tool_call_started')
          const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')
          const startedUrls = toolStarts
            .filter((event) => event.toolName === 'web_crawl')
            .map((event) => event.input.url)
            .filter((value): value is string => typeof value === 'string')
          const successfulFinalUrls = toolResults
            .filter((event) => event.toolName === 'web_crawl')
            .map(readResultFinalUrl)
            .filter((value): value is string => typeof value === 'string')
          const visitedHosts = [...new Set(successfulFinalUrls.map((url) => new URL(url).hostname))]
          const startedToolNames = toolStarts.map((event) => event.toolName)
          const exploredUrls = [...startedUrls, ...successfulFinalUrls]
          const deliveryText = String(result.output?.deliveryMarkdown || '')

          runtime.assertThat(
            result.output?.status === 'completed' &&
              startedUrls.length >= 4 &&
              successfulFinalUrls.length >= 4 &&
              includesUrl(startedUrls, result.site.entryUrl) &&
              includesUrl(successfulFinalUrls, result.site.employmentHubUrl) &&
              includesUrl(successfulFinalUrls, result.site.noticeUrl) &&
              includesUrl(exploredUrls, result.site.guideUrl) &&
              includesUrl(successfulFinalUrls, result.site.applyUrl) &&
              visitedHosts.includes('127.0.0.1') &&
              visitedHosts.includes('localhost') &&
              !startedToolNames.includes('browser_use') &&
              !startedToolNames.includes('terminal_run') &&
              /(灵活就业人员|杭州.*灵活就业.*可申请)/.test(deliveryText) &&
              /(身份证|社保缴费证明|申请表)/.test(deliveryText) &&
              /(2026-09-30|2026 年 9 月 30 日|2026年09月30日|2026年9月30日)/.test(deliveryText) &&
              /(在线提交申请|线上申请|灵活就业补贴申报)/.test(deliveryText),
            {
              name: 'human-live-web-crawl-multi-hop-cross-domain-reading',
              message:
                'live human 应围绕入口网址多次调用 web_crawl，跨域并多跳完成申请对象、材料、截止时间和线上办理方式整理。',
              data: {
                startedUrls,
                exploredUrls,
                successfulFinalUrls,
                deliveryMarkdown: result.output?.deliveryMarkdown
              }
            }
          )
        }
      })
    })
  })
})
