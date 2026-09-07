import { describe, expect, it } from 'vitest'
import {
  assertLivePublishAllowed,
  resolveReleaseStorageConfig
} from '../../../../scripts/release/storage/config.mjs'

describe('release storage config', () => {
  it('uses the domestic COS channel by default', () => {
    const config = resolveReleaseStorageConfig({
      SecretId: 'test-id',
      SecretKey: 'test-key'
    })

    expect(config.target).toBe('cos')
    expect(config.bucket).toBe('ncurator-1324873382')
    expect(config.endpoint).toBe('https://cos.ap-guangzhou.myqcloud.com')
    expect(config.addressingStyle).toBe('virtual')
    expect(config.publicBaseUrl).toBe('https://download.guanzhangai.cn')
  })

  it('retains R2 as an explicit overseas target', () => {
    const config = resolveReleaseStorageConfig({
      RELEASE_STORAGE_TARGET: 'r2',
      R2_ACCESS_KEY_ID: 'test-id',
      R2_SECRET_ACCESS_KEY: 'test-key',
      R2_ACCOUNT_ID: 'account',
      R2_BUCKET_NAME: 'ncurator',
      R2_PUBLIC_BASE_URL: 'https://download.ncurator.com'
    })

    expect(config.target).toBe('r2')
    expect(config.endpoint).toBe('https://account.r2.cloudflarestorage.com')
    expect(config.addressingStyle).toBe('path')
  })

  it('blocks every real publish unless the explicit confirmation is present', () => {
    expect(() => assertLivePublishAllowed({})).toThrow('live publish is locked')
    expect(() =>
      assertLivePublishAllowed({ NCURATOR_ALLOW_LIVE_PUBLISH: 'publish-to-production' })
    ).not.toThrow()
  })
})
