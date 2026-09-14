import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cacheModelIcons,
  modelIconFileNameFromUrl,
  resolveCachedIconUrl
} from '../../../../src/main/services/llm/modelIconCache'

describe('model icon cache', () => {
  let userDataPath = ''
  let originalUserDataPath = ''

  beforeEach(async () => {
    originalUserDataPath = process.env.NCURATOR_USER_DATA_PATH || ''
    userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-icon-cache-'))
    process.env.NCURATOR_USER_DATA_PATH = userDataPath
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    if (originalUserDataPath) process.env.NCURATOR_USER_DATA_PATH = originalUserDataPath
    else delete process.env.NCURATOR_USER_DATA_PATH
    await fs.rm(userDataPath, { recursive: true, force: true })
  })

  it('accepts official llm icon file names and rejects traversal', () => {
    expect(modelIconFileNameFromUrl('https://www.guanzhangai.cn/llm/deepseek.png')).toBe(
      'deepseek.png'
    )
    expect(modelIconFileNameFromUrl('https://www.guanzhangai.cn/llm/note.txt')).toBeNull()
    expect(modelIconFileNameFromUrl('https://www.guanzhangai.cn/llm/')).toBeNull()
  })

  it('rewrites cached icons to data urls without changing the catalog json', async () => {
    const remoteUrl = 'https://www.guanzhangai.cn/llm/deepseek.png'
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength)
      })
    )

    await cacheModelIcons([remoteUrl])
    const cached = await resolveCachedIconUrl(remoteUrl)
    expect(cached.startsWith('data:image/png;base64,')).toBe(true)
    const diskFile = path.join(userDataPath, 'llm-icons', 'deepseek.png')
    await expect(fs.readFile(diskFile)).resolves.toEqual(png)
  })
})
