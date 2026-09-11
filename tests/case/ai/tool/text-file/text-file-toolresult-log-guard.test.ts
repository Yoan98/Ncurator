import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createTextFileToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  TEXT_FILE_READ_MAX_BYTES,
  TEXT_FILE_READ_MAX_LINE_CHARS,
  TEXT_FILE_READ_MAX_LINES
} from '../../../../../src/main/services/ai/human/tools/textFile/toolSpecs'

type ReadResult = {
  sourcePath: string
  content: string
  startLine: number
  endLine: number
  totalLines: number
  nextStartLine?: number
}

describe('ai tool text-file bounded line reader', () => {
  it('text-file-bounded-line-window', async () => {
    await runBackendCase({
      caseId: 'text-file-bounded-line-window',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['text-file'],
      description: '验证 text_file_read 的 2000 行、约 50KiB、长行裁剪和 startLine 续读契约。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const harness = createTextFileToolHarness(runtime)
        const sourcePath = path.join(runtime.workspaceRoot, 'large-result.txt')
        const sourceLines = Array.from(
          { length: 3_000 },
          (_, index) => `line-${index + 1}-${'内容'.repeat(20)}`
        )
        await fs.writeFile(sourcePath, sourceLines.join('\n'), 'utf8')

        const first = await harness.invoke<ReadResult>('text_file_read', { sourcePath })
        const second = await harness.invoke<ReadResult>('text_file_read', {
          sourcePath,
          startLine: first.nextStartLine
        })

        const manyShortLinesPath = path.join(runtime.workspaceRoot, 'many-short-lines.txt')
        await fs.writeFile(manyShortLinesPath, Array(2_500).fill('x').join('\n'), 'utf8')
        const lineLimited = await harness.invoke<ReadResult>('text_file_read', {
          sourcePath: manyShortLinesPath
        })

        const longLinePath = path.join(runtime.workspaceRoot, 'long-line.txt')
        await fs.writeFile(
          longLinePath,
          `${'a'.repeat(TEXT_FILE_READ_MAX_LINE_CHARS - 1)}😀尾部`,
          'utf8'
        )
        const longLine = await harness.invoke<ReadResult>('text_file_read', {
          sourcePath: longLinePath
        })

        let excessiveLineCountError = ''
        try {
          await harness.invoke('text_file_read', {
            sourcePath,
            lineCount: TEXT_FILE_READ_MAX_LINES + 1
          })
        } catch (error) {
          excessiveLineCountError = error instanceof Error ? error.message : String(error)
        }

        return { first, second, lineLimited, longLine, excessiveLineCountError }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.first.startLine === 1 &&
            result.first.endLine < TEXT_FILE_READ_MAX_LINES &&
            result.first.nextStartLine === result.first.endLine + 1 &&
            Buffer.byteLength(result.first.content, 'utf8') < TEXT_FILE_READ_MAX_BYTES &&
            result.second.startLine === result.first.nextStartLine &&
            result.second.endLine > result.second.startLine &&
            result.second.nextStartLine === result.second.endLine + 1 &&
            result.lineLimited.endLine === TEXT_FILE_READ_MAX_LINES &&
            result.lineLimited.nextStartLine === TEXT_FILE_READ_MAX_LINES + 1 &&
            result.longLine.content.includes('... (line truncated to 2000 characters)') &&
            result.longLine.content.includes('😀') &&
            !result.longLine.content.includes('�') &&
            result.excessiveLineCountError.length > 0,
          {
            name: 'text-file-bounded-line-window',
            message: '按行读取应在约 50KiB 的完整行边界停止，可续读且不拆坏 Unicode。',
            data: {
              first: result.first,
              second: result.second,
              longLine: result.longLine,
              excessiveLineCountError: result.excessiveLineCountError
            }
          }
        )
      }
    })
  })
})
