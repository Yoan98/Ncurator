import { describe, expect, it } from 'vitest'
import {
  buildTruncatedToolResultMessage,
  countUnicodeCharacters,
  sliceUnicodeCharacters,
  TOOL_RESULT_HEAD_MAX_CHARS,
  TOOL_RESULT_INLINE_MAX_CHARS
} from '../../../../src/main/services/ai/human/shared/toolResultPersistence'
import { stripTerminalControlText } from '../../../../src/main/services/ai/human/tools/terminal/TerminalSessionManager'

describe('ai unit tool result truncation', () => {
  it('truncates to the max chars prefix and reports totals', () => {
    const fullContent = 'x'.repeat(TOOL_RESULT_INLINE_MAX_CHARS + 100)
    const message = buildTruncatedToolResultMessage({
      filePath: '/workspace/.ncurator/runtime/toolresult/run-1/abc.log',
      head: fullContent.slice(0, TOOL_RESULT_HEAD_MAX_CHARS),
      totalChars: fullContent.length
    })
    const parsed = JSON.parse(message) as {
      truncated: boolean
      filePath: string
      totalChars: number
      head: string
    }
    expect(parsed.truncated).toBe(true)
    expect(parsed.totalChars).toBe(fullContent.length)
    expect(parsed.head.length).toBe(TOOL_RESULT_HEAD_MAX_CHARS)
    expect(Object.keys(parsed).sort()).toEqual(['filePath', 'head', 'totalChars', 'truncated'])
    expect(parsed.filePath.endsWith('.log')).toBe(true)
  })

  it('returns a parseable envelope', () => {
    const message = buildTruncatedToolResultMessage({
      filePath: '/workspace/.ncurator/runtime/toolresult/run-1/def.log',
      head: 'prefix',
      totalChars: 200_000
    })
    expect(() => JSON.parse(message)).not.toThrow()
  })

  it('counts and slices Unicode characters without splitting surrogate pairs', () => {
    const content = `${'x'.repeat(TOOL_RESULT_HEAD_MAX_CHARS - 1)}😀tail`
    const head = sliceUnicodeCharacters(content, TOOL_RESULT_HEAD_MAX_CHARS)
    expect(countUnicodeCharacters(content)).toBe(TOOL_RESULT_HEAD_MAX_CHARS + 4)
    expect(countUnicodeCharacters(head)).toBe(TOOL_RESULT_HEAD_MAX_CHARS)
    expect(head.endsWith('😀')).toBe(true)
    expect(head).not.toContain('�')
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
