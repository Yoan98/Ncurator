import { describe, expect, it } from 'vitest'
import { isStableMacUpdateSignature } from '../../../../src/main/services/update/utils/macUpdateSignature'

const VALID_SIGNATURE = `
Authority=Ncurator Update Signing
designated => identifier "com.yoan.ncurator" and certificate leaf = H"fixed-certificate"
`

describe('macOS update signature', () => {
  it('accepts the fixed update signing identity', () => {
    expect(isStableMacUpdateSignature(0, VALID_SIGNATURE)).toBe(true)
  })

  it.each([
    ['codesign failure', 1, VALID_SIGNATURE],
    ['ad-hoc signature', 0, `${VALID_SIGNATURE}\nSignature=adhoc`],
    ['wrong authority', 0, VALID_SIGNATURE.replace('Ncurator Update Signing', 'Other Signing')],
    ['wrong app identifier', 0, VALID_SIGNATURE.replace('com.yoan.ncurator', 'com.other.app')],
    ['version-specific requirement', 0, `${VALID_SIGNATURE}\ndesignated => cdhash H"version-only"`]
  ])('rejects %s', (_label, status, output) => {
    expect(isStableMacUpdateSignature(status, output)).toBe(false)
  })
})
