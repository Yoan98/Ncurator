import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  resolveAppLocale,
  resolveDistribution,
  manualUrl,
  downloadPageUrl
} from '../../../../src/shared/appPreferences'
import { readAppDistribution } from '../../../../src/main/services/app/AppRuntime'
import { SqliteCore } from '../../../../src/main/services/storage/sqlite/SqliteCore'
import { AppSettingsStore } from '../../../../src/main/services/storage/domains/AppSettingsStore'

const directories: string[] = []
const cores: SqliteCore[] = []
afterEach(async () => {
  for (const core of cores.splice(0)) core.close()
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))
  )
})
const temporary = async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-preferences-'))
  directories.push(directory)
  return directory
}

describe('application language and service preferences', () => {
  it('matches preferred display languages, independently of regions and service routes', () => {
    expect(resolveAppLocale('system', ['ja-JP', 'en-US', 'zh-CN'])).toBe('en')
    expect(resolveAppLocale('system', ['zh-Hans-FI', 'en-US'])).toBe('zh-CN')
    expect(resolveAppLocale('system', ['fr-FR'])).toBe('en')
    expect(resolveAppLocale('en', ['zh-CN'])).toBe('en')
    expect(resolveDistribution(undefined)).toBe('domestic')
    expect(resolveDistribution('invalid')).toBe('domestic')
  })

  it('reads the installed marker and defaults domestically only when identification fails', async () => {
    const directory = await temporary()
    expect(readAppDistribution(directory)).toBe('domestic')
    await fs.writeFile(
      path.join(directory, 'app-distribution.json'),
      JSON.stringify({ distribution: 'international' })
    )
    expect(readAppDistribution(directory)).toBe('international')
    await fs.writeFile(path.join(directory, 'app-distribution.json'), '{bad')
    expect(readAppDistribution(directory)).toBe('domestic')
  })

  it('persists the first distribution default and merges concurrent partial settings', async () => {
    const directory = await temporary()
    const sqlite = new SqliteCore(path.join(directory, 'app.sqlite'))
    cores.push(sqlite)
    sqlite.initialize()
    const international = new AppSettingsStore(sqlite, 'international')
    expect(await international.get()).toMatchObject({
      language: 'system',
      serviceRoute: 'international'
    })
    await Promise.all([
      international.save({ language: 'en' }),
      international.save({ systemNotificationsEnabled: false })
    ])
    expect(await international.get()).toMatchObject({
      language: 'en',
      systemNotificationsEnabled: false,
      serviceRoute: 'international'
    })
    const domestic = new AppSettingsStore(sqlite, 'domestic')
    expect((await domestic.get()).serviceRoute).toBe('international')
    await domestic.save({ serviceRoute: 'domestic' })
    expect((await international.get()).serviceRoute).toBe('domestic')
  })

  it('separates help routing from distribution-specific download entrypoints', () => {
    const runtime = {
      distribution: 'international',
      locale: 'en',
      serviceRoute: 'domestic'
    } as const
    expect(manualUrl(runtime)).toBe('https://www.guanzhangai.cn/en/manual')
    expect(downloadPageUrl(runtime)).toBe('https://www.ncurator.com/en')
  })
})
