import { describe, expect, it } from 'vitest'
import { inspectTerminalOutputQuality } from '../../../src/main/services/ai/human/tools/terminal/terminalExec'

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
    const replacementReport = inspectTerminalOutputQuality(`${'�'.repeat(15)}${'a'.repeat(85)}`, '')
    const controlReport = inspectTerminalOutputQuality(`${'\u0001'.repeat(15)}${'b'.repeat(85)}`, '')

    expect(replacementReport.unusable).toBe(true)
    expect(replacementReport.replacementCharRatio).toBe(0.15)
    expect(replacementReport.matchedSignatures).toContain('REPLACEMENT_CHAR_RATIO')
    expect(controlReport.unusable).toBe(true)
    expect(controlReport.controlCharRatio).toBe(0.15)
    expect(controlReport.matchedSignatures).toContain('CONTROL_CHAR_RATIO')
  })
})
