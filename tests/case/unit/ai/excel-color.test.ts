import { describe, expect, it } from 'vitest'
import { toExcelArgb, toExcelRgb } from '../../../../src/main/services/ai/human/tools/excel/color'

describe('excel color contract', () => {
  it('writes 6-digit RGB as opaque ARGB and keeps 8-digit ARGB', () => {
    expect(toExcelArgb('FF0000')).toBe('FFFF0000')
    expect(toExcelArgb('#2266aa')).toBe('FF2266AA')
    expect(toExcelArgb('FF1F4E79')).toBe('FF1F4E79')
    expect(toExcelArgb('#fff2f2f2')).toBe('FFF2F2F2')
  })

  it('reads opaque ARGB back as 6-digit RGB', () => {
    expect(toExcelRgb('FFFF0000')).toBe('FF0000')
    expect(toExcelRgb('2266AA')).toBe('2266AA')
    expect(toExcelRgb('#FF2266AA')).toBe('2266AA')
    expect(toExcelRgb('80D14343')).toBe('80D14343')
  })
})
