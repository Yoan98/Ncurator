import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { TOOL_RESULT_INLINE_MAX_CHARS } from '../../../../../src/main/services/ai/human/shared/toolResultPersistence'
import { TEXT_FILE_READ_MAX_CHARS } from '../../../../../src/main/services/ai/human/tools/textFile/toolSpecs'
import { buildCompleteTaskDecision, buildLearnSkillsDecision } from '../testUtils'

const listLogFiles = async (rootPath: string): Promise<string[]> => {
  const entries = await fs.readdir(rootPath, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(rootPath, entry.name)
      if (entry.isDirectory()) return listLogFiles(entryPath)
      return entry.name.endsWith('.log') ? [entryPath] : []
    })
  )
  return nested.flat()
}

const readEnvelopeFilePath = (user: string): string | undefined =>
  user.match(/"filePath":"([^"]+)"/)?.[1]

describe('ai human mock-llm tool result truncation', () => {
  it('human-tool-result-truncation-read', async () => {
    await runBackendCase({
      caseId: 'human-tool-result-truncation-read',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 human 读取超大工具结果时完整内容落盘为 .log，模型收到整串截断信封；再次全量读取日志会收到超限错误并改为分段读取，不再产生二次落盘。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = path.join(runtime.workspaceRoot, 'large.txt')
        const smallSourcePath = path.join(runtime.workspaceRoot, 'small.txt')
        const longLine = '第 {index} 行内容用于验证工具结果整串截断与落盘。'
        const lines = Array.from({ length: 8_000 }, (_, index) =>
          longLine.replace('{index}', String(index + 1))
        )
        await fs.writeFile(sourcePath, lines.join('\n'), 'utf8')
        await fs.writeFile(smallSourcePath, 'SMALL_RESULT_REMAINS_COMPLETE', 'utf8')
        let modelReceivedBothIndependentResults = false
        let modelReceivedReadLimitError = false
        let modelReadLogInSegments = false

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
                    { name: 'text_file_read', args: { type: 'lines', sourcePath } },
                    { name: 'text_file_read', args: { type: 'lines', sourcePath: smallSourcePath } }
                  ]
                }
              },
              ({ user }) => {
                modelReceivedBothIndependentResults =
                  user.includes('"truncated":true') &&
                  user.includes('SMALL_RESULT_REMAINS_COMPLETE')
                const filePath = readEnvelopeFilePath(user)
                if (!filePath) throw new Error('missing truncated envelope filePath')
                return {
                  thought: { next: '全量读取截断日志。' },
                  toolCalls: [
                    { name: 'text_file_read', args: { type: 'chars', sourcePath: filePath } }
                  ]
                }
              },
              ({ user }) => {
                modelReceivedReadLimitError = user.includes('超过单次读取上限')
                const filePath = readEnvelopeFilePath(user)
                if (!filePath) throw new Error('missing truncated envelope filePath')
                return {
                  thought: { next: '按上限分段读取截断日志。' },
                  toolCalls: [
                    {
                      name: 'text_file_read',
                      args: {
                        type: 'chars',
                        sourcePath: filePath,
                        startOffset: 1,
                        charCount: TEXT_FILE_READ_MAX_CHARS
                      }
                    }
                  ]
                }
              },
              ({ user }) => {
                modelReadLogInSegments =
                  user.includes('"startOffset":1') &&
                  user.includes(`"endOffset":${TEXT_FILE_READ_MAX_CHARS}`)
                return {
                  output: buildCompleteTaskDecision({
                    summary: '已读完大文件内容。',
                    deliveryMarkdown: '大文件内容已读取。'
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
        const toolResultLogFiles = await listLogFiles(
          path.join(runtime.workspaceRoot, '.ncurator', 'runtime', 'toolresult')
        )
        const persistedContent = toolResultLogFiles[0]
          ? await fs.readFile(toolResultLogFiles[0], 'utf8')
          : ''
        return {
          output,
          toolResultLogFiles,
          persistedContent,
          modelReceivedBothIndependentResults,
          modelReceivedReadLimitError,
          modelReadLogInSegments
        }
      },
      assert: async (result, runtime) => {
        const persistedParseable =
          result.persistedContent.length > 0 &&
          (() => {
            try {
              JSON.parse(result.persistedContent)
              return true
            } catch {
              return false
            }
          })()
        runtime.assertThat(
          result.output.status === 'completed' &&
            result.toolResultLogFiles.length === 1 &&
            persistedParseable &&
            result.persistedContent.length > TOOL_RESULT_INLINE_MAX_CHARS &&
            result.modelReceivedBothIndependentResults &&
            result.modelReceivedReadLimitError &&
            result.modelReadLogInSegments,
          {
            name: 'human-large-tool-result-persisted-to-toolresult',
            message:
              '超大工具结果应完整落盘为单个 .log 文件（落盘内容为完整的可解析 JSON），再读日志超限应报错引导分段，分段读取后不再产生二次落盘。',
            data: {
              toolResultLogFiles: result.toolResultLogFiles,
              persistedContentLength: result.persistedContent.length,
              modelReceivedReadLimitError: result.modelReceivedReadLimitError,
              modelReadLogInSegments: result.modelReadLogInSegments
            }
          }
        )
      }
    })
  })
})
