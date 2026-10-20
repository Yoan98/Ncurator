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

  it('plans recovery independently for the current COS channel and an older R2 channel', async () => {
    const requests: string[] = []
    const channels = await prepareReleaseStoragePublication(fragment, environment, async (url) => {
      requests.push(url)
      return channelResponse(
        url,
        url.startsWith('https://download.guanzhangai.cn') ? '1.0.10' : '1.0.1'
      )
    })
    expect(channels.map(({ config, current }) => [config.target, current])).toEqual([
      ['cos', true],
      ['r2', false]
    ])
    expect(requests).toHaveLength(4)
  })

  it('recognizes both completed channels and a completely missing R2 channel', async () => {
    const complete = await prepareReleaseStoragePublication(fragment, environment, async (url) =>
      channelResponse(url, '1.0.10')
    )
    expect(complete.every((channel) => channel.current)).toBe(true)
    const missing = await prepareReleaseStoragePublication(fragment, environment, async (url) =>
      url.startsWith('https://download.ncurator.com')
        ? new Response('', { status: 404 })
        : channelResponse(url, '1.0.10')
    )
    expect(missing.map((channel) => channel.current)).toEqual([true, false])
  })

  it('rejects incomplete credentials before looking up either public channel', async () => {
    let requests = 0
    await expect(
      prepareReleaseStoragePublication(fragment, {}, async () => {
        requests += 1
        return new Response('', { status: 404 })
      })
    ).rejects.toThrow('missing environment variable')
    expect(requests).toBe(0)
  })

  it('rejects a newer version on either store, including a newer update feed alone', async () => {
    for (const base of RELEASE_PUBLIC_BASE_URLS) {
      for (const endpoint of ['/releases/', '/updates/']) {
        await expect(
          prepareReleaseStoragePublication(fragment, environment, async (url) =>
            channelResponse(
              url,
              url.startsWith(base) && url.includes(endpoint) ? '1.0.11' : '1.0.10'
            )
          )
        ).rejects.toThrow('refuse to downgrade')
      }
    }
  })

  it('fails closed when the R2 channel cannot be read', async () => {
    await expect(
      prepareReleaseStoragePublication(fragment, environment, async (url) =>
        url.startsWith('https://download.ncurator.com')
          ? new Response('', { status: 503 })
          : channelResponse(url, '1.0.10')
      )
    ).rejects.toThrow('HTTP 503')
  })

  it('resumes only the missing store and verifies both stores again on a retry', async () => {
    let r2Version = '1.0.1'
    vi.stubGlobal('fetch', async (url: string, options?: RequestInit) => {
      if (options?.method === 'HEAD') {
        return new Response(null, { headers: { 'content-length': '123' } })
      }
      return channelResponse(
        url,
        url.startsWith('https://download.guanzhangai.cn') ? '1.0.10' : r2Version
      )
    })
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
        if (args[0].endsWith('finalize.mjs')) r2Version = '1.0.10'
      }
    }
    const verified = { fragment, directory: '/candidate', fragmentPath: '/candidate/fragment.json' }
    await publishReleaseStorage(
      verified,
      await prepareReleaseStoragePublication(fragment, environment),
      options
    )
    expect(writes).toHaveLength(2)
    expect(writes[0]).toMatch(/upload-fragment\.mjs$/u)
    expect(writes[1]).toMatch(/finalize\.mjs$/u)
    expect(verifyStorage.mock.calls.map((call) => call[2]?.target)).toEqual(['cos', 'r2'])

    await publishReleaseStorage(
      verified,
      await prepareReleaseStoragePublication(fragment, environment),
      options
    )
    expect(writes).toHaveLength(2)
    expect(verifyStorage.mock.calls.map((call) => call[2]?.target)).toEqual([
      'cos',
      'r2',
      'cos',
      'r2'
    ])
  })

  it.each(['public download', 'storage hash'])(
    'stops before writing the second store when the first store fails %s verification',
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
