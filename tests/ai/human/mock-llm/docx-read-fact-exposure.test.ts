import { describe, it } from 'vitest'
import { writeTestDocxFile } from '../../../harness/backend/aiToolHarness'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxReadResult } from '../../tool/docx/testUtils'
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
      description: '验证 human prompt 会收到 outline 截断说明与兼容字形归一后的 docx 搜索命中。',
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
                  summary: '先学习 docx-read',
                  reason: '需要用真实 docx 工具阅读文档。',
                  expectedOutcome: '获得 docx 读取工具。'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'docx_outline',
                  args: {
                    sourcePath: 'docx-read-fact-exposure.docx',
                    maxBlocks: 200
                  },
                  summary: '提取文档结构',
                  reason: '需要检查 prompt 是否显式暴露截断事实。',
                  expectedOutcome: '拿到带截断信息的 outline。'
                })
              },
              (input) => {
                if (
                  !input.user.includes('结果已截断') ||
                  !input.user.includes('文档后续内容未包含')
                ) {
                  throw new Error('brain prompt is missing outline truncation fact exposure')
                }
                return buildToolDecision({
                  toolName: 'docx_read',
                  args: {
                    sourcePath: 'docx-read-fact-exposure.docx',
                    query: '反走样'
                  },
                  summary: '搜索反走样内容',
                  reason: '验证兼容字形归一后，普通查询能命中真实文档文本。',
                  expectedOutcome: '拿到搜索命中。'
                })
              },
              (input) => {
                if (
                  !input.user.includes('返回 1 项') ||
                  (!input.user.includes('反⾛样') && !input.user.includes('反走样'))
                ) {
                  throw new Error('brain prompt is missing normalized search hit exposure')
                }
                return buildCompleteTaskDecision({
                  summary: 'docx 读取事实暴露已验证。',
                  reason: 'outline 截断说明与搜索命中都已进入 prompt。',
                  expectedOutcome: '输出最终答复。'
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
        const searchResult = readLatestToolResultDataFromEvents<DocxReadResult>(
          result.events,
          'docx_read'
        )

        runtime.assertThat(
          result.output.status === 'completed' &&
            searchResult.matches.length === 1 &&
            result.output.deliveryMarkdown.includes('不应答成“未写”'),
          {
            name: 'human-brain-sees-truncation-and-normalized-search-facts',
            message: 'human prompt 应能读到 outline 截断说明和归一化搜索命中，并完成正确收口。',
            data: {
              searchResult,
              deliveryMarkdown: result.output.deliveryMarkdown
            }
          }
        )
      }
    })
  })
})
