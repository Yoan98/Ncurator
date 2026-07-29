import { describe, expect, it } from 'vitest'
import { assertSupportedPptDiffManifest } from '../../../../src/shared/pptDiffManifest'

describe('ppt diff manifest version', () => {
  it('accepts v4 and explicitly rejects legacy v3 artifacts', () => {
    expect(() => assertSupportedPptDiffManifest({ version: 4, slides: [] })).not.toThrow()
    expect(() => assertSupportedPptDiffManifest({ version: 3, slides: [] })).toThrow(
      'PPT 审核内容格式已过期，请重新生成修改记录'
    )
  })
})
