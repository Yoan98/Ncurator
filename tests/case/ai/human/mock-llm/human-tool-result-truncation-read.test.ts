import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { TOOL_RESULT_MAX_CHARS } from '../../../../../src/main/services/ai/human/shared/toolResultPersistence'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  buildToolDecision
} from '../testUtils'

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

describe('ai human mock-llm tool result truncation', () => {
  it('human-tool-result-truncation-read', async () => {
    await runBackendCase({
      caseId: 'human-tool-result-truncation-read',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 human 读取超大工具结果时完整内容落盘为 .log，模型收到整串截断信封。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = path.join(runtime.workspaceRoot, 'large.txt')
        const longLine = '第 {index} 行内容用于验证工具结果整串截断与落盘。'
        const lines = Array.from({ length: 8_000 }, (_, index) =>
          longLine.replace('{index}', String(index + 1))
        )
        await fs.writeFile(sourcePath, lines.join('\n'), 'utf8')

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
                output: buildToolDecision({
                  toolName: 'text_file_read',
                  args: { sourcePath },
                  summary: '读取大文件'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '已读完大文件内容。',
                  deliveryMarkdown: '大文件内容已读取。'
                })
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
          persistedContent
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
            result.toolResultLogFiles.length >= 1 &&
            persistedParseable &&
            result.persistedContent.length > TOOL_RESULT_MAX_CHARS,
          {
            name: 'human-large-tool-result-persisted-to-toolresult',
            message:
              '超大工具结果应完整落盘为 .log 文件，且落盘内容为完整的可解析 JSON（保留全文）。',
            data: {
              toolResultLogFiles: result.toolResultLogFiles,
              persistedContentLength: result.persistedContent.length
            }
          }
        )      }
    })
  })
})
