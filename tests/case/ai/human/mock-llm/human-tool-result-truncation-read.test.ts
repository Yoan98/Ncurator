import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { buildCompleteTaskDecision, buildLearnSkillsDecision } from '../testUtils'

const readNextStartLine = (user: string): number | undefined => {
  const value = user.match(/nextStartLine: (\d+)/u)?.[1]
  return value ? Number(value) : undefined
}

describe('ai human mock-llm bounded text file reading', () => {
  it('human-tool-result-truncation-read', async () => {
    await runBackendCase({
      caseId: 'human-tool-result-truncation-read',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description:
        '验证大文本读取返回英文行窗口和续读位置，同轮的小结果保持完整，不产生 toolresult 二次落盘。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = path.join(runtime.workspaceRoot, 'large.txt')
        const smallSourcePath = path.join(runtime.workspaceRoot, 'small.txt')
        const lines = Array.from(
          { length: 8_000 },
          (_, index) => `第 ${index + 1} 行内容用于验证按行窗口。${'补充'.repeat(10)}`
        )
        await fs.writeFile(sourcePath, lines.join('\n'), 'utf8')
        await fs.writeFile(smallSourcePath, 'SMALL_RESULT_REMAINS_COMPLETE', 'utf8')
        let modelReceivedBothResults = false
        let modelContinuedByLine = false

        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['text-file'],
                  summary: '学习文本读取能力'
                })
              },
              {
                output: {
                  thought: { next: '同轮读取大小两个文件。' },
                  toolCalls: [
                    { name: 'text_file_read', args: { sourcePath } },
                    { name: 'text_file_read', args: { sourcePath: smallSourcePath } }
                  ]
                }
              },
              ({ user }) => {
                const nextStartLine = readNextStartLine(user)
                modelReceivedBothResults =
                  Boolean(nextStartLine) &&
                  user.includes('SMALL_RESULT_REMAINS_COMPLETE') &&
                  user.includes('totalLines:')
                if (!nextStartLine) throw new Error('missing next startLine')
                return {
                  thought: { next: '从返回的下一行继续读取。' },
                  toolCalls: [
                    {
                      name: 'text_file_read',
                      args: { sourcePath, startLine: nextStartLine }
                    }
                  ]
                }
              },
              ({ user }) => {
                modelContinuedByLine = user.includes('<content>') && user.includes('第 ')
                return {
                  output: buildCompleteTaskDecision({
                    summary: '已继续读取大文件。',
                    deliveryMarkdown: '大文件已按行窗口继续读取。'
                  })
                }
              }
            ]
          }
        })
        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请读取 large.txt 的内容。'
        })
        const toolResultRoot = path.join(
          runtime.workspaceRoot,
          '.ncurator',
          'runtime',
          'toolresult'
        )
        const toolResultEntries = await fs
          .readdir(toolResultRoot, { recursive: true })
          .catch(() => [])
        return { output, modelReceivedBothResults, modelContinuedByLine, toolResultEntries }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.output.status === 'completed' &&
            result.modelReceivedBothResults &&
            result.modelContinuedByLine &&
            result.toolResultEntries.length === 0,
          {
            name: 'human-bounded-text-file-continuation',
            message: '模型应按返回的 startLine 续读，大结果不再依赖 JSON 截断日志。',
            data: result
          }
        )
      }
    })
  })
})
