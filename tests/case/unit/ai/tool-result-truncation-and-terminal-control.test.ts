import { describe, expect, it } from 'vitest'
import {
  buildTruncatedToolResultMessage,
  countUnicodeCharacters,
  sliceUnicodeCharacters,
  sliceUnicodeCharactersFromEnd,
  TOOL_RESULT_HEAD_MAX_CHARS,
  TOOL_RESULT_INLINE_MAX_CHARS,
  TOOL_RESULT_TAIL_MAX_CHARS
} from '../../../../src/main/services/ai/human/shared/toolResultPersistence'
import { stripTerminalControlText } from '../../../../src/main/services/ai/human/tools/terminal/TerminalSessionManager'

describe('ai unit tool result truncation', () => {
  it('renders an English head/tail spill message with totals', () => {
    const fullContent = 'x'.repeat(TOOL_RESULT_INLINE_MAX_CHARS + 100)
    const message = buildTruncatedToolResultMessage({
      filePath: '/workspace/.ncurator/runtime/toolresult/run-1/abc.txt',
      head: fullContent.slice(0, TOOL_RESULT_HEAD_MAX_CHARS),
      tail: fullContent.slice(-TOOL_RESULT_TAIL_MAX_CHARS),
      totalChars: fullContent.length,
      totalBytes: fullContent.length,
      totalLines: 1
    })
    expect(message).toContain('Result too large to include inline.')
    expect(message).toContain('abc.txt')
    expect(message).toContain('You MUST call text_file_read with sourcePath=')
    expect(message).toContain('Do not use the terminal to open or search this file.')
    expect(message).not.toContain('text_file_search')
    expect(message).toContain('Preview (head):')
    expect(message).toContain('Preview (tail):')
    expect(message.indexOf('text_file_read')).toBeLessThan(message.indexOf('Preview (head):'))
  })

  it('returns multiline text rather than a JSON envelope', () => {
    const message = buildTruncatedToolResultMessage({
      filePath: '/workspace/.ncurator/runtime/toolresult/run-1/def.txt',
      head: 'prefix',
      tail: 'suffix',
      totalChars: 200_000,
      totalBytes: 200_000,
      totalLines: 20
    })
    expect(() => JSON.parse(message)).toThrow()
    expect(message.split('\n').length).toBeGreaterThanOrEqual(8)
  })

  it('counts and slices Unicode characters without splitting surrogate pairs', () => {
    const content = `${'x'.repeat(TOOL_RESULT_HEAD_MAX_CHARS - 1)}😀tail`
    const head = sliceUnicodeCharacters(content, TOOL_RESULT_HEAD_MAX_CHARS)
    expect(countUnicodeCharacters(content)).toBe(TOOL_RESULT_HEAD_MAX_CHARS + 4)
    expect(countUnicodeCharacters(head)).toBe(TOOL_RESULT_HEAD_MAX_CHARS)
    expect(head.endsWith('😀')).toBe(true)
    expect(head).not.toContain('�')
    expect(sliceUnicodeCharactersFromEnd(content, 4)).toBe('tail')
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
