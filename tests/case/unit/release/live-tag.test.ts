import { describe, expect, it } from 'vitest'
import {
  findLiveChannelsForTag,
  isReleaseChannelCurrent
} from '../../../../scripts/release/shared/live-tag.mjs'

describe('release live tag detection', () => {
  it('reports channels whose latest manifest points at the tag', async () => {
    const calls: string[] = []
    const fetchImpl = async (url: string) => {
      calls.push(url)
      const live = url.includes('guanzhangai.cn') && url.includes('macos.json')
      return {
        ok: true,
        json: async () => (live ? { tag: 'mac-v1.0.0', version: '1.0.0' } : { tag: 'mac-v0.9.0' })
      }
    }

    await expect(findLiveChannelsForTag('mac-v1.0.0', fetchImpl)).resolves.toEqual([
      'https://download.guanzhangai.cn'
    ])
    expect(calls.some((url) => url.includes('download.guanzhangai.cn'))).toBe(true)
    expect(calls.some((url) => url.includes('download.ncurator.com'))).toBe(true)
  })

  it('returns empty when the tag is not live on any channel', async () => {
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({ tag: 'mac-v0.1.0' })
    })
    await expect(findLiveChannelsForTag('mac-v1.0.0', fetchImpl)).resolves.toEqual([])
  })

  it.each(['windows', 'mac'] as const)(
    'verifies the %s manifest and relative update URL against the candidate',
    async (family) => {
      const base = 'https://download.guanzhangai.cn'
      const tag = `${family}-v1.0.0`
      const folder = family === 'windows' ? 'windows' : 'macos'
      const installerName =
        family === 'windows' ? '馆长-1.0.0-Windows-x64.exe' : '馆长-1.0.0-macos-arm64.dmg'
      const installer = {
        role: 'installer',
        name: installerName,
        size: 123,
        sha512: 'installer-hash'
      }
      const update =
        family === 'windows'
          ? installer
          : { role: 'update', name: 'Ncurator-mac-arm64.zip', size: 456, sha512: 'zip-hash' }
      const fragment = {
        tag,
        platform: family === 'windows' ? 'windows-x64' : 'macos-arm64',
        files: [installer, ...(family === 'mac' ? [update] : [])]
      }
      const manifest = {
        version: '1.0.0',
        tag,
        downloads: {
          [family === 'windows' ? 'x64' : 'arm64']: {
            ...installer,
            url: `${base}/artifacts/${folder}/${tag}/${installerName}`
          }
        }
      }
      let metadata = `version: 1.0.0\nfiles:\n  - url: ../../artifacts/${folder}/${tag}/${update.name}\n    size: ${update.size}\n    sha512: ${update.sha512}\n`
      const fetchImpl = async (url: string) =>
        new Response(url.includes('.json') ? JSON.stringify(manifest) : metadata)
      await expect(isReleaseChannelCurrent(fragment, base, fetchImpl)).resolves.toBe(true)
      metadata = metadata.replace(`/${tag}/`, '/old-tag/')
      await expect(isReleaseChannelCurrent(fragment, base, fetchImpl)).resolves.toBe(false)
      metadata = metadata.replace('version: 1.0.0', 'version: 1.0.1')
      await expect(isReleaseChannelCurrent(fragment, base, fetchImpl)).rejects.toThrow(
        'refuse to downgrade'
      )
    }
  )

  it('distinguishes an absent channel from a failed lookup', async () => {
    const fragment = {
      tag: 'windows-v1.0.0',
      platform: 'windows-x64',
      files: [{ role: 'installer', name: 'installer.exe', size: 123, sha512: 'hash' }]
    }
    await expect(
      isReleaseChannelCurrent(
        fragment,
        'https://example.com',
        async () => new Response(null, { status: 404 })
      )
    ).resolves.toBe(false)
    await expect(
      isReleaseChannelCurrent(
        fragment,
        'https://example.com',
        async () => new Response(null, { status: 503 })
      )
    ).rejects.toThrow('HTTP 503')
  })
})
