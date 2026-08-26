import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createTextFileToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { TEXT_FILE_READ_MAX_CHARS } from '../../../../../src/main/services/ai/human/tools/textFile/toolSpecs'

describe('ai tool text-file toolresult log guard', () => {
  it('text-file-toolresult-log-read-guard', async () => {
    await runBackendCase({
      caseId: 'text-file-toolresult-log-read-guard',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['text-file'],
      description: '验证 text_file_read 对 toolresult 截断日志的字符上限守卫：超限报错、按上限分段可读、普通大文件不受限、Unicode 切片安全。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const harness = createTextFileToolHarness(runtime)
        const toolResultRoot = path.join(runtime.workspaceRoot, '.ncurator', 'runtime', 'toolresult')
        const logPath = path.join(toolResultRoot, 'run-1', 'abc.log')
        const singleLineContent = `${'结果字段-'.repeat(1_000)}${'x'.repeat(
          TEXT_FILE_READ_MAX_CHARS + 10_000
        )}`
        await fs.mkdir(path.dirname(logPath), { recursive: true })
        await fs.writeFile(logPath, singleLineContent, 'utf8')

        let fullCharsReadError = ''
        try {
          await harness.invoke('text_file_read', { type: 'chars', sourcePath: logPath })
        } catch (error) {
          fullCharsReadError = error instanceof Error ? error.message : String(error)
        }

        let fullLinesReadError = ''
        try {
          await harness.invoke('text_file_read', { type: 'lines', sourcePath: logPath })
        } catch (error) {
          fullLinesReadError = error instanceof Error ? error.message : String(error)
        }

        const firstSegment = await harness.invoke<{
          type: 'chars'
          content: string
          startOffset: number
          endOffset: number
          totalChars: number
        }>('text_file_read', {
          type: 'chars',
          sourcePath: logPath,
          startOffset: 1,
          charCount: TEXT_FILE_READ_MAX_CHARS
        })
        const secondSegment = await harness.invoke<{
          type: 'chars'
          content: string
          startOffset: number
          endOffset: number
          totalChars: number
        }>('text_file_read', {
          type: 'chars',
          sourcePath: logPath,
          startOffset: TEXT_FILE_READ_MAX_CHARS + 1,
          charCount: TEXT_FILE_READ_MAX_CHARS
        })

        const bigUserFile = path.join(runtime.workspaceRoot, 'big-user-file.txt')
        await fs.writeFile(
          bigUserFile,
          'y'.repeat(TEXT_FILE_READ_MAX_CHARS + 5_000),
          'utf8'
        )
        const bigUserRead = await harness.invoke<{
          type: 'chars'
          content: string
          totalChars: number
        }>('text_file_read', { type: 'chars', sourcePath: bigUserFile })

        const emojiPath = path.join(runtime.workspaceRoot, 'emoji.txt')
        await fs.writeFile(
          emojiPath,
          `${'a'.repeat(TEXT_FILE_READ_MAX_CHARS - 1)}😀尾部`,
          'utf8'
        )
        const emojiRead = await harness.invoke<{
          type: 'chars'
          content: string
          startOffset: number
          endOffset: number
          totalChars: number
        }>('text_file_read', {
          type: 'chars',
          sourcePath: emojiPath,
          startOffset: TEXT_FILE_READ_MAX_CHARS,
          charCount: 2
        })

        return {
          fullCharsReadError,
          fullLinesReadError,
          singleLineTotalChars: Array.from(singleLineContent).length,
          firstSegment,
          secondSegment,
          bigUserRead,
          emojiRead
        }
      },
      assert: async (result, runtime) => {
        const limitText = String(TEXT_FILE_READ_MAX_CHARS)
        runtime.assertThat(
          result.fullCharsReadError.includes('超过单次读取上限') &&
            result.fullCharsReadError.includes(limitText) &&
            result.fullLinesReadError.includes('超过单次读取上限') &&
            result.firstSegment.type === 'chars' &&
            result.firstSegment.startOffset === 1 &&
            result.firstSegment.endOffset === TEXT_FILE_READ_MAX_CHARS &&
            result.firstSegment.totalChars === result.singleLineTotalChars &&
            result.firstSegment.content ===
              '结果字段-'.repeat(1_000) + 'x'.repeat(TEXT_FILE_READ_MAX_CHARS - 5_000) &&
            result.secondSegment.startOffset === TEXT_FILE_READ_MAX_CHARS + 1 &&
            result.secondSegment.endOffset === result.singleLineTotalChars &&
            result.secondSegment.totalChars === result.singleLineTotalChars &&
            result.secondSegment.content.length ===
              result.singleLineTotalChars - TEXT_FILE_READ_MAX_CHARS &&
            result.bigUserRead.type === 'chars' &&
            result.bigUserRead.content.length === TEXT_FILE_READ_MAX_CHARS + 5_000 &&
            result.bigUserRead.totalChars === TEXT_FILE_READ_MAX_CHARS + 5_000 &&
            result.emojiRead.content === '😀尾' &&
            result.emojiRead.startOffset === TEXT_FILE_READ_MAX_CHARS &&
            result.emojiRead.endOffset === TEXT_FILE_READ_MAX_CHARS + 1 &&
            !result.emojiRead.content.includes('�'),
          {
            name: 'text-file-toolresult-log-read-guard',
            message: 'toolresult 日志读取超出单次上限应报错引导分段，分段读取成功且不破坏 Unicode 字符；普通大文件不受限。',
            data: {
              fullCharsReadError: result.fullCharsReadError,
              firstSegment: result.firstSegment,
              secondSegment: result.secondSegment
            }
          }
        )
      }
    })
  })
})