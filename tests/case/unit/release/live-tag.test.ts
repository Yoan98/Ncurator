import { describe, expect, it } from 'vitest'
import { findLiveChannelsForTag } from '../../../../scripts/release/shared/live-tag.mjs'

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
})
