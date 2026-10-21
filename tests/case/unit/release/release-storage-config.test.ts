import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertLivePublishAllowed,
  resolveReleaseStorageConfig,
  resolveReleaseStorageConfigs
} from '../../../../scripts/release/storage/config.mjs'
import {
  prepareReleaseStoragePublication,
  publishReleaseStorage
} from '../../../../scripts/release/storage/publish.mjs'
import { RELEASE_PUBLIC_BASE_URLS } from '../../../../scripts/release/shared/live-tag.mjs'
import * as liveTag from '../../../../scripts/release/shared/live-tag.mjs'

const environment = {
  SecretId: 'cos-id',
  SecretKey: 'cos-key',
  R2_ACCESS_KEY_ID: 'r2-id',
  R2_SECRET_ACCESS_KEY: 'r2-key',
  R2_ACCOUNT_ID: 'account',
  R2_BUCKET_NAME: 'ncurator',
  R2_PUBLIC_BASE_URL: 'https://download.ncurator.com'
}

const fragment = {
  tag: 'windows-v1.0.10',
  platform: 'windows-x64',
  files: [{ name: 'installer.exe', role: 'installer', size: 123, sha512: 'release-hash' }]
}

const channelResponse = (url: string, version: string) => {
  const base = new URL(url).origin
  const asset = `../../artifacts/windows/windows-v${version}/installer.exe`
  if (url.includes('/updates/')) {
    return new Response(
      `version: ${version}\nfiles:\n  - url: ${asset}\n    size: 123\n    sha512: release-hash\n`
    )
  }
  return Response.json({
    tag: `windows-v${version}`,
    version,
    downloads: {
      x64: {
        name: 'installer.exe',
        url: `${base}/artifacts/windows/windows-v${version}/installer.exe`,
        size: 123,
        sha512: 'release-hash'
      }
    }
  })
}

describe('release storage config', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

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

  it('selects R2 for a single-target recovery', () => {
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

  it('requires both stores for platform releases regardless of the recovery selector', () => {
    for (const selector of ['cos', 'r2']) {
      const configs = resolveReleaseStorageConfigs({
        ...environment,
        RELEASE_STORAGE_TARGET: selector
      })
      expect(configs.map((config) => config.target)).toEqual(['cos', 'r2'])
      expect(configs.map((config) => config.publicBaseUrl)).toEqual(RELEASE_PUBLIC_BASE_URLS)
      expect(configs[0].credentials.AWS_ACCESS_KEY_ID).toBe('cos-id')
      expect(configs[1].credentials.AWS_ACCESS_KEY_ID).toBe('r2-id')
    }
    expect(() => resolveReleaseStorageConfigs({ SecretId: 'id', SecretKey: 'key' })).toThrow(
      'R2_PUBLIC_BASE_URL'
    )
  })

  it('prepares exactly the storage belonging to each distribution', async () => {
    for (const [distribution, target, base] of [
      ['domestic', 'cos', 'https://download.guanzhangai.cn'],
      ['international', 'r2', 'https://download.ncurator.com']
    ]) {
      const requests: string[] = []
      const channels = await prepareReleaseStoragePublication(
        { ...fragment, distribution },
        environment,
        async (url: string) => {
          requests.push(url)
          return channelResponse(url, '1.0.10')
        }
      )
      expect(channels.map(({ config, current }) => [config.target, current])).toEqual([
        [target, true]
      ])
      expect(requests).toHaveLength(2)
      expect(requests.every((url) => url.startsWith(base))).toBe(true)
    }
  })

  it('rejects incomplete credentials before any public lookup', async () => {
    let requests = 0
    await expect(
      prepareReleaseStoragePublication(fragment, {}, async () => {
        requests++
        return new Response('', { status: 404 })
      })
    ).rejects.toThrow('missing environment variable')
    expect(requests).toBe(0)
  })

  it('rejects newer versions on the corresponding manifest or update feed', async () => {
    for (const distribution of ['domestic', 'international']) {
      for (const endpoint of ['/releases/', '/updates/']) {
        await expect(
          prepareReleaseStoragePublication(
            { ...fragment, distribution },
            environment,
            async (url: string) =>
              channelResponse(url, url.includes(endpoint) ? '1.0.11' : '1.0.10')
          )
        ).rejects.toThrow('refuse to downgrade')
      }
    }
  })

  it('fails closed when the selected international channel cannot be read', async () => {
    await expect(
      prepareReleaseStoragePublication(
        { ...fragment, distribution: 'international' },
        environment,
        async () => new Response('', { status: 503 })
      )
    ).rejects.toThrow('HTTP 503')
  })

  it('resumes the missing international publication and verifies its own storage', async () => {
    let version = '1.0.1'
    vi.stubGlobal('fetch', async (url: string, options?: RequestInit) =>
      options?.method === 'HEAD'
        ? new Response(null, { headers: { 'content-length': '123' } })
        : channelResponse(url, version)
    )
    const verifyStorage = vi
      .spyOn(liveTag, 'verifyReleaseStorageFragment')
      .mockResolvedValue(undefined)
    const writes: string[] = []
    const options = {
      root: process.cwd(),
      awsExecutable: 'test-aws',
      run: async (_command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
        expect(options.env.RELEASE_STORAGE_TARGET).toBe('r2')
        writes.push(args[0])
        if (args[0].endsWith('finalize.mjs')) version = '1.0.10'
      }
    }
    const international = { ...fragment, distribution: 'international' }
    const verified = {
      fragment: international,
      directory: '/candidate',
      fragmentPath: '/candidate/fragment.json'
    }
    await publishReleaseStorage(
      verified,
      await prepareReleaseStoragePublication(international, environment),
      options
    )
    expect(writes).toHaveLength(2)
    await publishReleaseStorage(
      verified,
      await prepareReleaseStoragePublication(international, environment),
      options
    )
    expect(writes).toHaveLength(2)
    expect(verifyStorage.mock.calls.map((call) => call[2]?.target)).toEqual(['r2', 'r2'])
  })

  it('rejects publishing a domestic artifact into international storage', async () => {
    const international = await prepareReleaseStoragePublication(
      { ...fragment, distribution: 'international' },
      environment,
      async (url: string) => channelResponse(url, '1.0.10')
    )
    const run = vi.fn()
    await expect(
      publishReleaseStorage(
        { fragment, directory: '/candidate', fragmentPath: '/candidate/fragment.json' },
        international,
        { root: process.cwd(), run }
      )
    ).rejects.toThrow('cannot be published to this storage')
    expect(run).not.toHaveBeenCalled()
  })

  it.each(['public download', 'storage hash'])(
    'stops publication when its storage fails %s verification',
    async (failure) => {
      vi.stubGlobal('fetch', async (url: string, options?: RequestInit) =>
        options?.method === 'HEAD'
          ? new Response(null, {
              headers: { 'content-length': failure === 'public download' ? '124' : '123' }
            })
          : channelResponse(url, '1.0.10')
      )
      const verifyStorage = vi.spyOn(liveTag, 'verifyReleaseStorageFragment')
      if (failure === 'storage hash') {
        verifyStorage.mockRejectedValue(new Error('storage hash mismatch'))
      }
      const run = vi.fn()
      await expect(
        publishReleaseStorage(
          { fragment, directory: '/candidate', fragmentPath: '/candidate/fragment.json' },
          await prepareReleaseStoragePublication(fragment, environment),
          { root: process.cwd(), awsExecutable: 'test-aws', run }
        )
      ).rejects.toThrow(
        failure === 'public download' ? 'asset verification failed' : 'hash mismatch'
      )
      expect(run).not.toHaveBeenCalled()
    }
  )

  it('blocks every real publish unless the explicit confirmation is present', () => {
    expect(() => assertLivePublishAllowed({})).toThrow('live publish is locked')
    expect(() =>
      assertLivePublishAllowed({ NCURATOR_ALLOW_LIVE_PUBLISH: 'publish-to-production' })
    ).not.toThrow()
  })
})
