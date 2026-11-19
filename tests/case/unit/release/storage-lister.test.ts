import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createReleaseStorageClient,
  createReleaseStorageLister
} from '../../../../scripts/release/storage/client.mjs'

const { execFile, loadReleaseEnvironment } = vi.hoisted(() => ({
  execFile: vi.fn(),
  loadReleaseEnvironment: vi.fn()
}))

vi.mock('node:child_process', () => ({ execFile }))
vi.mock('../../../../scripts/release/shared/environment.mjs', () => ({
  loadReleaseEnvironment
}))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetAllMocks()
})

describe('production release storage capability', () => {
  it('lists without live approval and exposes no generic or mutating operation', async () => {
    vi.stubEnv('NCURATOR_ALLOW_LIVE_PUBLISH', '')
    vi.stubEnv('R2_PUBLIC_BASE_URL', 'https://download.ncurator.com')
    vi.stubEnv('R2_BUCKET_NAME', 'fixture-bucket')
    vi.stubEnv('R2_ACCOUNT_ID', 'fixture-account')
    vi.stubEnv('R2_ACCESS_KEY_ID', 'fixture-access')
    vi.stubEnv('R2_SECRET_ACCESS_KEY', 'fixture-secret')
    vi.stubEnv('NCURATOR_AWS_CLI', 'fixture-aws')
    execFile.mockImplementation((_, args: string[], _options, callback) => {
      expect(args.slice(0, 2)).toEqual(['s3api', 'list-objects-v2'])
      const page = args.includes('--continuation-token')
        ? { Contents: [{ Key: 'releases/b' }] }
        : { Contents: [{ Key: 'releases/a' }], IsTruncated: true, NextContinuationToken: 'next' }
      callback(null, { stdout: JSON.stringify(page) })
    })

    const lister = await createReleaseStorageLister('/ignored', { target: 'r2' })
    expect(Object.keys(lister)).toEqual(['listKeys'])
    await expect(lister.listKeys('releases/')).resolves.toEqual(['releases/a', 'releases/b'])
    expect(execFile).toHaveBeenCalledTimes(2)

    await expect(createReleaseStorageClient('/ignored', { target: 'r2' })).rejects.toThrow(
      'live publish is locked'
    )
    expect(execFile).toHaveBeenCalledTimes(2)
  })
})
