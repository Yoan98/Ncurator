import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getFileIcon: vi.fn()
  },
  nativeImage: {
    createFromPath: vi.fn()
  }
}))

import {
  MACOS_LIST_SCRIPT,
  OpenWithService
} from '../../../../src/main/services/openWith/OpenWithService'

const temporaryDirectories: string[] = []

const createFile = async (): Promise<string> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-open-with-'))
  temporaryDirectories.push(directory)
  const filePath = path.join(directory, 'report.md')
  await fs.writeFile(filePath, '# report')
  return filePath
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true }))
  )
})

describe('OpenWithService', () => {
  it('returns the system default first and removes duplicate system handlers', async () => {
    const filePath = await createFile()
    const service = new OpenWithService({
      runNativeList: vi.fn().mockResolvedValue({
        defaultApplicationId: 'com.example.editor',
        applications: [
          {
            id: 'com.example.viewer',
            name: 'Viewer',
            path: '/Applications/Viewer.app',
            isDefault: false
          },
          {
            id: 'com.example.editor',
            name: 'Editor',
            path: '/Applications/Editor.app',
            isDefault: true
          },
          {
            id: 'com.example.viewer',
            name: 'Viewer duplicate',
            path: '/Applications/Viewer-copy.app',
            isDefault: false
          }
        ]
      }),
      getIconDataUrl: async (applicationPath) => `icon:${applicationPath}`
    })

    const result = await service.list(filePath)

    expect(result).toMatchObject({
      success: true,
      defaultApplicationId: 'com.example.editor',
      applications: [
        { id: 'com.example.editor', name: 'Editor', isDefault: true },
        { id: 'com.example.viewer', name: 'Viewer', isDefault: false }
      ]
    })
    expect(result.applications[0]?.iconDataUrl).toBe('icon:/Applications/Editor.app')
  })

  it('does not drop applications beyond the first five handlers', async () => {
    const filePath = await createFile()
    const service = new OpenWithService({
      runNativeList: vi.fn().mockResolvedValue({
        applications: Array.from({ length: 7 }, (_, index) => ({
          id: `application-${index}`,
          name: `Application ${index}`,
          isDefault: index === 6
        }))
      })
    })

    const result = await service.list(filePath)

    expect(result.applications).toHaveLength(7)
    expect(result.applications[0]).toMatchObject({ id: 'application-6', isDefault: true })
  })

  it('only opens a handler returned by the system query and reuses its cache', async () => {
    const filePath = await createFile()
    const runNativeList = vi.fn().mockResolvedValue({
      applications: [
        {
          id: 'system-handler',
          name: 'System Editor',
          path: '/Applications/System Editor.app',
          isDefault: true
        }
      ]
    })
    const runNativeOpen = vi.fn().mockResolvedValue({ success: true })
    const onOpened = vi.fn()
    const service = new OpenWithService({ runNativeList, runNativeOpen })

    await service.list(filePath)
    expect(await service.open(filePath, 'untrusted-path', onOpened)).toEqual({
      success: false,
      error: 'application is not available for this file'
    })
    expect(onOpened).not.toHaveBeenCalled()
    expect(await service.open(filePath, 'system-handler', onOpened)).toEqual({ success: true })
    expect(onOpened).toHaveBeenCalledOnce()
    expect(onOpened).toHaveBeenCalledWith(expect.objectContaining({ id: 'system-handler' }))
    expect(runNativeList).toHaveBeenCalledTimes(1)
    expect(runNativeOpen).toHaveBeenCalledWith(
      filePath,
      expect.objectContaining({ id: 'system-handler' })
    )
    runNativeOpen.mockResolvedValueOnce({ success: false })
    await service.open(filePath, 'system-handler', onOpened)
    expect(onOpened).toHaveBeenCalledOnce()
  })

  it('uses public macOS workspace association APIs', () => {
    expect(MACOS_LIST_SCRIPT).toContain('URLForApplicationToOpenURL')
    expect(MACOS_LIST_SCRIPT).toContain('URLsForApplicationsToOpenURL')
    expect(MACOS_LIST_SCRIPT).toContain('CFBundleIconFile')
  })

  it('uses the application bundle icon path when the system provides it', async () => {
    const filePath = await createFile()
    const getIconDataUrl = vi.fn().mockResolvedValue('icon:data')
    const service = new OpenWithService({
      runNativeList: vi.fn().mockResolvedValue({
        applications: [
          {
            id: 'com.example.editor',
            name: 'Editor',
            path: '/Applications/Editor.app',
            iconPath: '/Applications/Editor.app/Contents/Resources/Editor.icns',
            isDefault: true
          }
        ]
      }),
      getIconDataUrl
    })

    await service.list(filePath)

    expect(getIconDataUrl).toHaveBeenCalledWith(
      '/Applications/Editor.app',
      '/Applications/Editor.app/Contents/Resources/Editor.icns'
    )
  })

  it('uses Windows shell association handlers instead of an application list', async () => {
    const helper = await fs.readFile(
      path.join(process.cwd(), 'resources', 'open-with', 'windows-open-with.txt'),
      'utf8'
    )
    expect(helper).toContain('SHAssocEnumHandlers')
    expect(helper).toContain('IAssocHandler')
    expect(helper).toContain('enum AssocFilter : uint { Recommended = 1 }')
    expect(helper).toContain('[Console]::OutputEncoding = $utf8')
    expect(helper).toContain('interface IShellItem')
    expect(helper).toContain('shellItem.BindToHandler')
    expect(helper).toContain('B8C0BD9F-ED24-455C-83E6-D5390C4FE8C4')
    expect(helper).toContain('handler.Invoke(dataObject)')
    expect(helper).not.toContain('Visual Studio Code')
    expect(helper).not.toContain('Microsoft Word')
  })

  it.runIf(process.platform === 'darwin' || process.platform === 'win32')(
    'queries the current operating system for real handlers',
    async () => {
      const filePath = await createFile()
      const result = await new OpenWithService().list(filePath)

      expect(result.success).toBe(true)
      expect(result.applications.length).toBeGreaterThan(0)
      expect(result.applications.some((application) => application.isDefault)).toBe(true)
      expect(result.defaultApplicationId).toBeTruthy()
    }
  )
})

describe('application preferences', () => {
  it('keeps one-time opens separate from per-extension preferences and recovers missing applications', async () => {
    const filePath = await createFile(),
      preferences = new Map<string, string>()
    let available = true,
      queryFailed = false
    const open = vi.fn<
      (filePath: string, application: { id: string }) => Promise<{ success: boolean }>
    >(async () => ({ success: true }))
    const changed = vi.fn()
    const service = new OpenWithService({
      preferences: {
        get: (key) => preferences.get(key),
        set: (key, id) => {
          if (id === null) preferences.delete(key)
          else preferences.set(key, id)
        }
      },
      onPreferenceChanged: changed,
      runNativeList: async () =>
        queryFailed
          ? { error: 'query failed' }
          : {
              applications: [
                { id: 'system', name: 'System', isDefault: true },
                ...(available ? [{ id: 'wps', name: 'WPS', isDefault: false }] : [])
              ]
            },
      runNativeOpen: open
    })
    expect((await service.setPreferred(filePath, 'wps')).defaultApplicationId).toBe('wps')
    expect(open).not.toHaveBeenCalled()
    expect((await service.list(filePath)).preferredApplicationId).toBe('wps')
    await service.open(filePath, 'system')
    expect(preferences.get('.md')).toBe('wps')
    await service.open(filePath)
    expect(open.mock.calls.at(-1)?.[1]).toMatchObject({ id: 'wps' })
    queryFailed = true
    expect((await service.list(filePath)).success).toBe(false)
    expect(preferences.get('.md')).toBe('wps')
    queryFailed = false
    available = false
    expect(await service.list(filePath)).toMatchObject({
      success: true,
      defaultApplicationId: 'system',
      preferenceReset: true
    })
    expect(preferences.has('.md')).toBe(false)
    expect(changed).toHaveBeenCalledWith('.md')
    available = true
    await service.setPreferred(filePath, 'wps')
    expect((await service.setPreferred(filePath, null)).defaultApplicationId).toBe('system')
  })
})
