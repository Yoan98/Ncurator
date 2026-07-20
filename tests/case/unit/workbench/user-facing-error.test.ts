import { describe, expect, it } from 'vitest'
import { normalizeUserFacingError } from '../../../../src/renderer/src/utils/userFacingError'

describe('user-facing error normalization', () => {
  it('hides application internals', () => {
    expect(
      normalizeUserFacingError(
        'RecursionLimit reached in /Users/example/project/src/main/graph.ts',
        '运行失败'
      )
    ).toBe('运行失败')
  })

  it('keeps provider messages readable', () => {
    expect(
      normalizeUserFacingError('Your account has not activated the selected model', '模型请求失败')
    ).toBe('Your account has not activated the selected model')
  })
})
