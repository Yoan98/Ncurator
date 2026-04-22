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
  it('docx-search-alias-then-range-read', async () => {
    await runBackendCase({
      caseId: 'docx-search-alias-then-range-read',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 human 会先做 literal 搜索，命中 alias fallback 后再进入区间精读。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'alias-read.docx', [
          {
            type: 'paragraph',
            text: '过度拟合是指模型记住过多训练数据中的特征值。'
          },
          {
            type: 'paragraph',
            text: '训练时间过久时更容易出现这一问题，可结合数据增强来缓解。'
          }
        ])

        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['docx-read'],
                  summary: '先学习 docx-read',
                  reason: '需要先搜索再精读文档。',
                  expectedOutcome: '获得搜索与区间读取工具。'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'docx_search',
                  args: {
                    sourcePath: 'alias-read.docx',
                    query: '过拟合'
                  },
                  summary: '先按原词搜索',
                  reason: '验证工具层 alias fallback 是否生效。',
                  expectedOutcome: '通过 alias fallback 命中过度拟合内容。'
                })
              },
              () => {
                const searchResult = readLatestToolResultDataFromEvents<DocxSearchResult>(
                  runtime.eventCollector.snapshot(),
                  'docx_search'
                )
                return buildToolDecision({
                  toolName: 'docx_read_blocks',
                  args: {
                    sourcePath: 'alias-read.docx',
                    fromBlockId: searchResult.matches[0]!.blockId,
                    toBlockId: searchResult.matches[0]!.nextBodyBlockId
                  },
                  summary: '精读命中段落',
                  reason: '读取连续区间，拿到定义、成因和处理线索。',
                  expectedOutcome: '拿到完整事实。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: 'alias fallback 与区间精读已验证。',
                  reason: '搜索与精读都成功返回真实内容。',
                  expectedOutcome: '输出最终答复。'
                })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: 'alias fallback 与区间精读已验证。',
                  deliveryMarkdown:
                    '# Alias Fallback\n\n文档把过拟合写作过度拟合，并给出了训练时间过久与数据增强等线索。'
                }
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请按我选的 docx 资料，说明过拟合是什么、为什么会出现、怎么处理。'
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
            searchResult.effectiveQuery === '过度拟合' &&
            searchResult.appliedAliases.length === 1 &&
            readResult.blocks.length === 2 &&
            readResult.blocks.some(
              (block) => block.type === 'paragraph' && block.text.includes('记住过多训练数据中的特征值')
            ) &&
            readResult.blocks.some(
              (block) => block.type === 'paragraph' && block.text.includes('数据增强')
            ),
          {
            name: 'human-can-use-alias-search-then-range-read',
            message: 'mock-llm 下 human 应能先做 alias fallback 搜索，再进入区间精读。',
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
