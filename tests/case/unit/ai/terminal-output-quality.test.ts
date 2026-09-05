import { describe, expect, it } from 'vitest'
import {
  formatTerminalUnusableError,
  inspectTerminalOutputQuality
} from '../../../../src/main/services/ai/human/tools/terminal/terminalExec'

describe('ai unit terminal output quality', () => {
  it('does not reject short office header snippets by signature alone', () => {
    const report = inspectTerminalOutputQuality('PK\u0003\u0004 word/document.xml', '')

    expect(report.unusable).toBe(false)
  })

  it('does not reject normal text output', () => {
    const report = inspectTerminalOutputQuality('alpha\nbeta\ngamma\n', '')

    expect(report.unusable).toBe(false)
  })

  it('does not reject below the 25% unusable ratio threshold', () => {
    const replacementOutput = `${'�'.repeat(24)}${'a'.repeat(76)}`
    const controlOutput = `${'\u0001'.repeat(24)}${'b'.repeat(76)}`
    expect(inspectTerminalOutputQuality(replacementOutput, '').unusable).toBe(false)
    expect(inspectTerminalOutputQuality(controlOutput, '').unusable).toBe(false)
  })

  it('uses 25% ratio thresholds for replacement and C0 control characters', () => {
    const replacementOutput = `${'�'.repeat(25)}${'a'.repeat(75)}`
    const controlOutput = `${'\u0001'.repeat(25)}${'b'.repeat(75)}`
    const replacementReport = inspectTerminalOutputQuality(replacementOutput, '')
    const controlReport = inspectTerminalOutputQuality(controlOutput, '')

    expect(replacementReport.unusable).toBe(true)
    expect(replacementReport.replacementCharRatio).toBe(0.25)
    expect(formatTerminalUnusableError({ report: replacementReport, output: replacementOutput })).toBe(
      '终端输出含过多不可读字符：替换符 25/100（25%），控制字符 0/100（0%）；样例：�。'
    )

    expect(controlReport.unusable).toBe(true)
    expect(controlReport.controlCharRatio).toBe(0.25)
    expect(formatTerminalUnusableError({ report: controlReport, output: controlOutput })).toBe(
      '终端输出含过多不可读字符：替换符 0/100（0%），控制字符 25/100（25%）；样例：U+0001。'
    )
  })
})
