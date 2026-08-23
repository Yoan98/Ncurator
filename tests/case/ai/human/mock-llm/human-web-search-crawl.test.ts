import { describe, it } from 'vitest'
import type { WebCrawlerService } from '../../../../../src/main/services/webCrawler/types'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { buildCompleteTaskDecision, buildToolDecision, filterAiRunEventsByType } from '../testUtils'

describe('ai human mock-llm web backend', () => {
  it('human-web-search-crawl', async () => {
    await runBackendCase({
      caseId: 'human-web-search-crawl',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 human 使用 web_search 搜索并读取网页正文整合事实。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const service: WebCrawlerService = {
          async search(input) {
            return {
              query: input.query,
              results: [
                {
                  rank: 1,
                  title: '补贴通知',
                  url: 'https://example.test/policy',
                  snippet: '申报通知'
                }
              ],
              raw: {}
            }
          },
          async crawl(input) {
            return {
              requestedUrl: input.url,
              finalUrl: input.url,
              title: '补贴通知',
              markdown: '申报截止时间为 2026-09-30。',
              publishedAt: '2026-06-10',
              links: { internal: [], external: [] },
              raw: {}
            }
          },
          async close() {}
        }
        const runner = createHumanTestRunner(runtime, {
          webCrawlerService: service,
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildToolDecision({
                  toolName: 'web_search',
                  args: { query: '灵活就业补贴截止时间' },
                  summary: '搜索候选网页'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'web_search',
                  args: { url: 'https://example.test/policy' },
                  summary: '读取通知正文'
                })
              },
              { output: buildCompleteTaskDecision({ summary: '已查到截止时间。' }) }
            ],
            'human.mouth': [
              {
                output: {
                  summary: '已查到截止时间。',
                  deliveryMarkdown: '申报截止时间为 2026-09-30。来源：https://example.test/policy'
                }
              }
            ]
          }
        })
        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '查找灵活就业补贴的申报截止时间，并基于正文回答。'
        })
        return { output, events: runtime.eventCollector.snapshot() }
      },
      assert: async (result, runtime) => {
        const results = filterAiRunEventsByType(result.events, 'tool_call_result')
        runtime.assertThat(
          result.output.status === 'completed' &&
            results.map((event) => event.toolName).join(',') === 'web_search,web_search' &&
            result.output.deliveryMarkdown.includes('2026-09-30') &&
            result.output.deliveryMarkdown.includes('https://example.test/policy'),
          {
            name: 'human-web-search-to-crawl',
            message: 'human 应先搜索候选，再读取正文，并只用已读取事实完成回答。',
            data: result
          }
        )
      }
    })
  })
})
