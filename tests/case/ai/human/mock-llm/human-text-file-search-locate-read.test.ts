import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
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

const readFirstCharOffset = (user: string): string | undefined =>
  user.match(/"charOffset":(\d+)/)?.[1]

describe('ai human mock-llm text-file search', () => {
  it('human-text-file-search-locate-read', async () => {
    await runBackendCase({
      caseId: 'human-text-file-search-locate-read',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证截断日志通过 text_file_search 定位关键词后，用返回的全文件字符偏移配合 type=chars 精确读取，不再二次落盘。',
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
                output: buildLearnSkillsDecision({
                  skillIds: ['text-file'],
                  summary: '学习文本读取能力'
                })
              },
              {
                output: {
                  thought: { next: '读取大文件触发截断。' },
                  toolCalls: [
                    { name: 'text_file_read', args: { type: 'lines', sourcePath } }
                  ]
                }
              },
              ({ user }) => {
                const filePath = readEnvelopeFilePath(user)
                if (!filePath) throw new Error('missing truncated envelope filePath')
                return {
                  thought: { next: '在截断日志中定位关键词。' },
                  toolCalls: [
                    {
                      name: 'text_file_search',
                      args: { sourcePath: filePath, query: '第 5000 行' }
                    }
                  ]
                }
              },
              ({ user }) => {
                modelSearchedLog = user.includes('"totalMatchCount":1')
                const filePath = readEnvelopeFilePath(user)
                const charOffset = readFirstCharOffset(user)
                if (!filePath || !charOffset) {
                  throw new Error('missing search result filePath or charOffset')
                }
                return {
                  thought: { next: '按定位的字符偏移精确读取。' },
                  toolCalls: [
                    {
                      name: 'text_file_read',
                      args: {
                        type: 'chars',
                        sourcePath: filePath,
                        startOffset: Number(charOffset),
                        charCount: 40
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
        const toolResultLogFiles = await listLogFiles(
          path.join(runtime.workspaceRoot, '.ncurator', 'runtime', 'toolresult')
        )
        return {
          output,
          toolResultLogFiles,
          modelSearchedLog,
          modelReadLocatedSegment
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.output.status === 'completed' &&
            result.toolResultLogFiles.length === 1 &&
            result.modelSearchedLog &&
            result.modelReadLocatedSegment,
          {
            name: 'human-text-file-search-locate-read-chain',
            message:
              '截断日志应通过 text_file_search 定位关键词、用返回的 charOffset 配合 type=chars 精确读取成功，且不再产生二次落盘。',
            data: {
              toolResultLogFiles: result.toolResultLogFiles,
              modelSearchedLog: result.modelSearchedLog,
              modelReadLocatedSegment: result.modelReadLocatedSegment
            }
          }
        )
      }
    })
  })
})