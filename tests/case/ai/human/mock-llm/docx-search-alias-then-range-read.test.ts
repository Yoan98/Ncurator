import { describe, it } from 'vitest'
import { writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { DocxReadResult, DocxSearchResult } from '../../tool/docx/testUtils'
import { readDocxNodeText } from '../../tool/docx/testUtils'
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
                  summary: '先学习 docx-read'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'docx_search',
                  args: {
                    sourcePath: 'alias-read.docx',
                    query: '过拟合'
                  },
                  summary: '先按原词搜索'
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
                    range: {
                      type: 'block_ids',
                      blockIds: [
                        searchResult.matches[0]!.blockId,
                        searchResult.matches[0]!.nextBlockId!
                      ]
                    }
                  },
                  summary: '精读命中段落'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: 'alias fallback 与区间精读已验证。'
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
              (block) =>
                block.type === 'paragraph' &&
                readDocxNodeText(block).includes('记住过多训练数据中的特征值')
            ) &&
            readResult.blocks.some(
              (block) => block.type === 'paragraph' && readDocxNodeText(block).includes('数据增强')
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
