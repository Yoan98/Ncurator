import { describe, expect, it } from 'vitest'
import { inspectTerminalOutputQuality } from '../../../src/main/services/ai/human/tools/terminal/terminalOutputQuality'

describe('ai unit terminal output quality', () => {
  it('detects obvious office binary output signatures', () => {
    const report = inspectTerminalOutputQuality('PK\u0003\u0004 word/document.xml', '')

    expect(report.unusable).toBe(true)
    expect(report.matchedSignatures).toEqual(
      expect.arrayContaining(['PK_HEADER', 'OFFICE_WORD_XML'])
    )
  })

  it('does not reject normal text output', () => {
    const report = inspectTerminalOutputQuality('alpha\nbeta\ngamma\n', '')

    expect(report.unusable).toBe(false)
    expect(report.matchedSignatures).toEqual([])
  })

  it('uses ratio thresholds for replacement and C0 control characters', () => {
    const replacementReport = inspectTerminalOutputQuality(`${'�'.repeat(35)}${'a'.repeat(65)}`, '')
    const controlReport = inspectTerminalOutputQuality(`${'\u0001'.repeat(30)}${'b'.repeat(70)}`, '')

    expect(replacementReport.unusable).toBe(true)
    expect(replacementReport.replacementCharRatio).toBe(0.35)
    expect(replacementReport.matchedSignatures).toContain('REPLACEMENT_CHAR_RATIO')
    expect(controlReport.unusable).toBe(true)
    expect(controlReport.controlCharRatio).toBe(0.3)
    expect(controlReport.matchedSignatures).toContain('CONTROL_CHAR_RATIO')
  })
})
