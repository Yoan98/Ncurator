import { describe, it } from 'vitest'
import { writeTestDocxFile } from '../../../harness/backend/aiToolHarness'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxReadResult, DocxSearchResult } from '../../tool/docx/testUtils'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  buildToolDecision,
  readLatestToolResultDataFromEvents
} from '../testUtils'

describe('ai human mock-llm backend', () => {
  it('docx-read-fact-exposure', async () => {
    await runBackendCase({
      caseId: 'docx-read-fact-exposure',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 human prompt 会收到 outline 截断与兼容字形搜索命中的结构化事实摘要。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(
          runtime.workspaceRoot,
          'docx-read-fact-exposure.docx',
          Array.from({ length: 230 }, (_, index) => ({
            type: 'paragraph' as const,
            text:
              index === 5
                ? '反⾛样会在采样不足时出现明显锯齿。'
                : `第 ${String(index + 1)} 段普通说明。`
          }))
        )

        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['docx-read'],
                  summary: '先学习 docx-read'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'docx_outline',
                  args: {
                    sourcePath: 'docx-read-fact-exposure.docx',
                    ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 229 }]
                  },
                  summary: '提取文档结构'
                })
              },
              (input) => {
                if (
                  !input.user.includes('"blocks"') ||
                  !input.user.includes('"blockIndex": 0') ||
                  !input.user.includes('"blockIndex": 229') ||
                  !input.user.includes('第 230 段普通说明。')
                ) {
                  throw new Error('brain prompt is missing outline range structured facts')
                }
                return buildToolDecision({
                  toolName: 'docx_search',
                  args: {
                    sourcePath: 'docx-read-fact-exposure.docx',
                    query: '反走样'
                  },
                  summary: '搜索反走样内容'
                })
              },
              (input) => {
                if (
                  !input.user.includes('"returnedMatchCount": 1') ||
                  (!input.user.includes('反⾛样') && !input.user.includes('反走样'))
                ) {
                  throw new Error('brain prompt is missing normalized search hit structured facts')
                }
                const searchResult = readLatestToolResultDataFromEvents<DocxSearchResult>(
                  runtime.eventCollector.snapshot(),
                  'docx_search'
                )
                return buildToolDecision({
                  toolName: 'docx_read_blocks',
                  args: {
                    sourcePath: 'docx-read-fact-exposure.docx',
                    range: { type: 'block_ids', blockIds: [searchResult.matches[0]!.blockId] }
                  },
                  summary: '精读搜索命中'
                })
              },
              (input) => {
                if (
                  !input.user.includes('"blocks"') ||
                  !input.user.includes('反⾛样会在采样不足时出现明显锯齿')
                ) {
                  throw new Error('brain prompt is missing range read structured facts')
                }
                return buildCompleteTaskDecision({
                  summary: 'docx 读取事实暴露已验证。'
                })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: 'docx 读取事实暴露已验证。',
                  deliveryMarkdown: '# Docx Read Facts\n\n文档里明确写了反走样，不应答成“未写”。'
                }
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请按当前 docx 资料回答，不要把文档已写的内容说成未写。'
        })

        return {
          output,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const searchResult = readLatestToolResultDataFromEvents<DocxSearchResult>(
          result.events,
          'docx_search'
        )
        const readResult = readLatestToolResultDataFromEvents<DocxReadResult>(
          result.events,
          'docx_read_blocks'
        )

        runtime.assertThat(
          result.output.status === 'completed' &&
            searchResult.matches.length === 1 &&
            readResult.blocks.length === 1 &&
            result.output.deliveryMarkdown.includes('不应答成“未写”'),
          {
            name: 'human-brain-sees-truncation-and-normalized-search-structured-facts',
            message: 'human prompt 应能读到 outline 截断、归一化搜索命中与区间精读的结构化事实摘要，并完成正确收口。',
            data: {
              searchResult,
              readResult,
              deliveryMarkdown: result.output.deliveryMarkdown
            }
          }
        )
      }
    })
  })
})
