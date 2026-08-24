import { describe, expect, it } from 'vitest'
import {
  buildTruncatedToolResultMessage,
  TOOL_RESULT_MAX_CHARS
} from '../../../../src/main/services/ai/human/shared/toolResultPersistence'
import { stripTerminalControlText } from '../../../../src/main/services/ai/human/tools/terminal/TerminalSessionManager'

describe('ai unit tool result truncation', () => {
  it('truncates to the max chars prefix and reports totals', () => {
    const fullContent = 'x'.repeat(TOOL_RESULT_MAX_CHARS + 100)
    const message = buildTruncatedToolResultMessage({
      toolName: 'text_file_read',
      filePath: '/workspace/.ncurator/runtime/toolresult/run-1/abc.log',
      head: fullContent.slice(0, TOOL_RESULT_MAX_CHARS),
      totalChars: fullContent.length
    })
    const parsed = JSON.parse(message) as {
      truncated: boolean
      filePath: string
      maxChars: number
      totalChars: number
      head: string
    }
    expect(parsed.truncated).toBe(true)
    expect(parsed.maxChars).toBe(TOOL_RESULT_MAX_CHARS)
    expect(parsed.totalChars).toBe(fullContent.length)
    expect(parsed.head.length).toBe(TOOL_RESULT_MAX_CHARS)
    expect(parsed.filePath.endsWith('.log')).toBe(true)
  })

  it('returns a parseable envelope', () => {
    const message = buildTruncatedToolResultMessage({
      toolName: 'terminal_read',
      filePath: '/workspace/.ncurator/runtime/toolresult/run-1/def.log',
      head: 'prefix',
      totalChars: 200_000
    })
    expect(() => JSON.parse(message)).not.toThrow()
  })
})

describe('ai unit terminal control text', () => {
  it('collapses carriage-return overwritten progress lines', () => {
    const raw = 'downloading 10%\rdownloading 50%\rdownloading 100%\n'
    expect(stripTerminalControlText(raw)).toBe('downloading 100%\n')
  })

  it('keeps normal multi-line output unchanged', () => {
    const raw = 'line one\nline two\n'
    expect(stripTerminalControlText(raw)).toBe('line one\nline two\n')
  })

  it('collapses progress segments within a line even without trailing newline', () => {
    const raw = '10%\r20%\r30%'
    expect(stripTerminalControlText(raw)).toBe('30%')
  })
})
