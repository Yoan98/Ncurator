import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { buildCompleteTaskDecision, buildLoadToolsetsDecision } from '../testUtils'

describe('ai human mock-llm text-file search', () => {
  it('human-text-file-search-locate-read', async () => {
    await runBackendCase({
      caseId: 'human-text-file-search-locate-read',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description:
        '验证通过 text_file_search 的行号定位大文本，再用 text_file_read 的 startLine 精确读取。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = path.join(runtime.workspaceRoot, 'large.txt')
        const longLine = '第 {index} 行内容用于验证工具结果整串截断与落盘。'
        const lines = Array.from({ length: 8_000 }, (_, index) =>
          longLine.replace('{index}', String(index + 1))
        )
        await fs.writeFile(sourcePath, lines.join('\n'), 'utf8')
        let modelSearchedLog = false
        let modelReadLocatedSegment = false

        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLoadToolsetsDecision({
                  toolsetIds: ['text-file'],
                  summary: '学习文本读取能力'
                })
              },
              {
                output: {
                  thought: { next: '直接搜索目标行。' },
                  toolCalls: [
                    {
                      name: 'text_file_search',
                      args: { sourcePath, query: '第 5000 行' }
                    }
                  ]
                }
              },
              ({ user }) => {
                modelSearchedLog = user.includes('Total matches: 1') && user.includes('line=5000')
                return {
                  thought: { next: '按命中行号精确读取。' },
                  toolCalls: [
                    {
                      name: 'text_file_read',
                      args: {
                        sourcePath,
                        startLine: 5000,
                        lineCount: 1
                      }
                    }
                  ]
                }
              },
              ({ user }) => {
                modelReadLocatedSegment = user.includes('第 5000 行')
                return {
                  output: buildCompleteTaskDecision({
                    summary: '已定位并读取目标内容。',
                    deliveryMarkdown: '已通过搜索定位并读取第 5000 行内容。'
                  })
                }
              }
            ]
          }
        })
        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请读取 large.txt 的完整内容。'
        })
        return {
          output,
          modelSearchedLog,
          modelReadLocatedSegment
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.output.status === 'completed' &&
            result.modelSearchedLog &&
            result.modelReadLocatedSegment,
          {
            name: 'human-text-file-search-locate-read-chain',
            message: '应通过 text_file_search 定位行号，再用 startLine 精确读取成功。',
            data: {
              modelSearchedLog: result.modelSearchedLog,
              modelReadLocatedSegment: result.modelReadLocatedSegment
            }
          }
        )
      }
    })
  })
})
