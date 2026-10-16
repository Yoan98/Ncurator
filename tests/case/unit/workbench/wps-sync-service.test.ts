import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OfficeReviewSelection } from '../../../../src/shared/fileReview'
import type {
  WpsAddonAvailability,
  WpsHost,
  WpsIntegrationNotice
} from '../../../../src/shared/wpsIntegration'

vi.mock('electron', () => ({
  app: {
    isPackaged: false
  },
  shell: {
    openPath: async () => ''
  }
}))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn: vi.fn(() => ({
      unref: () => undefined,
      once: () => undefined
    }))
  }
})

import { spawn } from 'node:child_process'
import { shell } from 'electron'

import {
  authAddinNeedsRewrite,
  mergeAuthAddin,
  readAddonAvailability
} from '../../../../src/main/services/wps/authAddin'
import {
  WPS_ADDON_DIR_NAME,
  WPS_ADDON_NAME,
  WPS_ADDON_PORT_FILE,
  WPS_PREFERRED_SYNC_PORT
} from '../../../../src/main/services/wps/constants'
import {
  notifyOfficeFileWritten,
  setOfficeFileWriteListener,
  waitForOfficePathUnlocked,
  withOfficeFileWrite
} from '../../../../src/main/services/wps/officeFileWriteNotify'
import {
  mergePublishXml,
  publishXmlHasAddonUrl,
  toAddonLoopbackUrl
} from '../../../../src/main/services/wps/publishXml'
import {
  resolveWpsJsAddonsDir,
  WpsAddonInstaller
} from '../../../../src/main/services/wps/WpsAddonInstaller'
import {
  resolveWpsComponentExe,
  resolveWpsOfficeAppPath
} from '../../../../src/main/services/wps/wpsOfficeLaunch'
import {
  WpsOpenDocumentRegistry,
  WpsSyncService
} from '../../../../src/main/services/wps/WpsSyncService'

const temporaryDirectories: string[] = []
const services: WpsSyncService[] = []

const createTempDir = async (prefix: string): Promise<string> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2_000
): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for WPS sync event')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

const expectShellReopen = async (filePath: string, component: string): Promise<void> => {
  const resolved = path.resolve(filePath)
  const exe = resolveWpsComponentExe(component, resolved)
  const macApp = process.platform === 'darwin' ? resolveWpsOfficeAppPath() : undefined
  await waitFor(() => {
    if (macApp) return vi.mocked(spawn).mock.calls.length > 0
    if (process.platform === 'win32' && exe) return vi.mocked(spawn).mock.calls.length > 0
    return vi.mocked(shell.openPath).mock.calls.length > 0
  })
  if (macApp) {
    expect(spawn).toHaveBeenCalledWith(
      '/usr/bin/open',
      ['-g', '-a', macApp, '--', resolved],
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    )
    return
  }
  if (process.platform === 'win32' && exe) {
    expect(vi.mocked(spawn)).toHaveBeenCalledWith(
      exe,
      [resolved],
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    )
    expect(String(vi.mocked(spawn).mock.calls[0]?.[0] || '').toLowerCase()).not.toContain('cmd')
    return
  }
  expect(shell.openPath).toHaveBeenCalledWith(resolved)
}

const readSseEvents = (
  port: number,
  component = 'wps',
  clientId = `client-${component}-${Math.random().toString(36).slice(2, 8)}`
): {
  clientId: string
  events: Array<{ type?: string; path?: string; requestId?: string }>
  close: () => void
} => {
  const events: Array<{ type?: string; path?: string; requestId?: string }> = []
  const controller = new AbortController()
  void fetch(`http://127.0.0.1:${port}/events?component=${component}&clientId=${clientId}`, {
    signal: controller.signal
  })
    .then(async (response) => {
      if (!response.body) return
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const frames = buffer.split('\n\n')
        buffer = frames.pop() || ''
        for (const frame of frames) {
          const line = frame.split('\n').find((item) => item.startsWith('data: '))
          if (!line) continue
          events.push(JSON.parse(line.slice(6)) as { type?: string; path?: string })
        }
      }
    })
    .catch(() => undefined)
  return {
    clientId,
    events,
    close: () => controller.abort()
  }
}

const postReport = async (
  port: number,
  body: {
    kind?: string
    component: string
    clientId: string
    at?: number
    data: Record<string, unknown>
  }
): Promise<void> => {
  await fetch(`http://127.0.0.1:${port}/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

const reportOpenItems = async (
  port: number,
  input: { component: string; clientId: string; fullNames: readonly string[] }
): Promise<void> => {
  await postReport(port, {
    component: input.component,
    clientId: input.clientId,
    data: {
      items: input.fullNames.map((fullName) => ({ name: path.basename(fullName), fullName }))
    }
  })
}

afterEach(async () => {
  setOfficeFileWriteListener(undefined)
  vi.mocked(spawn).mockClear()
  await Promise.all(services.splice(0).map((service) => service.stop()))
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true }))
  )
})

describe('WPS publish.xml merge', () => {
  it('keeps third-party entries, replaces our addon, and strips the POC name', () => {
    const merged = mergePublishXml(
      `<jsplugins>
  <jspluginonline name="other" type="wps" url="http://example.local/addon" enable="true" install=""/>
  <jspluginonline name="ncuratorsyncpoc" type="wps" url="http://127.0.0.1:58123/addon" enable="true" install=""/>
  <jspluginonline name="ncurator-sync" type="et" url="file:///old/" enable="true" install=""/>
</jsplugins>
`,
      toAddonLoopbackUrl(58123)
    )

    expect(merged).toContain('name="other"')
    expect(merged).not.toContain('ncuratorsyncpoc')
    expect(merged.match(/name="ncurator-sync"/g)?.length).toBe(3)
    expect(merged).toContain('type="wps"')
    expect(merged).toContain('type="et"')
    expect(merged).toContain('type="wpp"')
    expect(merged).toContain('url="http://127.0.0.1:58123/addon/"')
    expect(merged).toContain('<jspluginonline ')
    expect(merged).toContain('enable="enable_dev"')
    expect(merged).toContain('debug=""')
    expect(publishXmlHasAddonUrl(merged, toAddonLoopbackUrl(58123))).toBe(true)
    expect(publishXmlHasAddonUrl(merged, toAddonLoopbackUrl(58129))).toBe(false)
  })

  it('does not keep an XML declaration inside jsplugins', () => {
    const merged = mergePublishXml(
      `<?xml version="1.0" encoding="UTF-8"?>
<jsplugins>
  <jspluginonline name="ncurator-sync" type="wps" url="file:///old/" enable="true" install=""/>
</jsplugins>
`,
      toAddonLoopbackUrl(58123)
    )
    expect(merged).toContain('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
    expect(merged.startsWith('<?xml')).toBe(true)
    expect(merged.replace(/^<\?xml[\s\S]*?\?>\s*/, '').startsWith('<jsplugins>')).toBe(true)
    expect(merged).not.toMatch(/<jsplugins>[\s\S]*<\?xml/)
  })
})

describe('WPS authaddin merge', () => {
  it('distinguishes a disabled record from absence, ambiguity and malformed configuration', () => {
    const record = (enable: boolean) => ({ name: 'ncurator-sync', enable })
    const raw = JSON.stringify({ wps: { a: record(false) }, et: { a: record(true) } })
    expect(readAddonAvailability(raw, 'wps')).toBe('disabled')
    expect(readAddonAvailability(raw, 'et')).toBe('enabled')
    expect(readAddonAvailability(raw, 'wpp')).toBe('unconfirmed')
    expect(readAddonAvailability('{', 'wps')).toBe('unconfirmed')
    expect(
      readAddonAvailability(JSON.stringify({ wps: { a: record(true), b: record(false) } }), 'wps')
    ).toBe('unconfirmed')
  })

  it('rewrites our entries to HTTP mode without changing enable', () => {
    const merged = mergeAuthAddin(
      JSON.stringify({
        wps: {
          abc: {
            enable: true,
            mode: 1,
            name: 'ncurator-sync',
            path: '/tmp/ncurator-sync_1.0.0'
          },
          namelist: 'abc'
        },
        et: {
          other: {
            enable: false,
            mode: 1,
            name: 'third-party',
            path: '/tmp/other'
          }
        }
      }),
      'http://127.0.0.1:58123/addon'
    )
    const parsed = JSON.parse(merged) as {
      wps: { abc: { mode: number; path: string; enable: boolean; name: string } }
      et: { other: { mode: number; path: string } }
    }
    expect(parsed.wps.abc).toEqual({
      enable: true,
      mode: 2,
      name: 'ncurator-sync',
      path: 'http://127.0.0.1:58123/addon/'
    })
    expect(parsed.et.other.path).toBe('/tmp/other')
    expect(parsed.et.other.mode).toBe(1)
  })

  it('does not rewrite auth when the loopback URL already matches', () => {
    const raw = JSON.stringify({
      et: {
        abc: {
          enable: true,
          mode: 2,
          name: 'ncurator-sync',
          path: 'http://127.0.0.1:58123/addon'
        },
        namelist: 'abc'
      },
      wpp: {
        namelist: 'orphan'
      }
    })
    expect(authAddinNeedsRewrite(raw, 'http://127.0.0.1:58123/addon/')).toBe(false)
    const merged = mergeAuthAddin(raw, 'http://127.0.0.1:58123/addon/')
    const parsed = JSON.parse(merged) as {
      et: { abc: { path: string }; namelist?: string }
      wpp: { namelist?: string }
    }
    expect(parsed.et.abc.path).toBe('http://127.0.0.1:58123/addon')
    expect(parsed.et.namelist).toBe('abc')
    expect(parsed.wpp.namelist).toBe('orphan')
  })

  it('rewrites a stolen temporary port back to the preferred loopback URL', () => {
    const raw = JSON.stringify({
      et: {
        abc: {
          enable: true,
          mode: 2,
          name: 'ncurator-sync',
          path: 'http://127.0.0.1:56749/addon'
        },
        namelist: 'abc'
      },
      wpp: {
        namelist: 'abc'
      }
    })
    expect(authAddinNeedsRewrite(raw, 'http://127.0.0.1:58123/addon')).toBe(true)
    const merged = mergeAuthAddin(raw, 'http://127.0.0.1:58123/addon')
    const parsed = JSON.parse(merged) as {
      et: { abc: { path: string }; namelist?: string }
      wpp: { namelist?: string }
    }
    expect(parsed.et.abc.path).toBe('http://127.0.0.1:58123/addon/')
    expect(parsed.et.namelist).toBe('abc')
    expect(parsed.wpp.namelist).toBe('abc')
  })
})

describe('WpsAddonInstaller', () => {
  it('does not create WPS config when jsaddons parent is missing', async () => {
    const homedir = await createTempDir('ncurator-wps-home-')
    expect(
      resolveWpsJsAddonsDir({
        platform: 'darwin',
        homedir,
        env: {}
      })
    ).toBeUndefined()
  })

  it('registers the loopback addon and removes leftover offline directories', async () => {
    const jsAddonsDir = await createTempDir('ncurator-wps-jsaddons-')
    await fs.mkdir(path.join(jsAddonsDir, WPS_ADDON_DIR_NAME), { recursive: true })
    await fs.writeFile(
      path.join(jsAddonsDir, WPS_ADDON_DIR_NAME, 'ribbon.xml'),
      '<offline/>',
      'utf8'
    )
    await fs.writeFile(
      path.join(jsAddonsDir, 'jsaddinblockhost.ini'),
      '[Mainhost]\nblocked=1\n',
      'utf8'
    )
    await fs.writeFile(
      path.join(jsAddonsDir, 'authaddin.json'),
      JSON.stringify({
        wps: {
          abc: {
            enable: true,
            mode: 1,
            name: 'ncurator-sync',
            path: path.join(jsAddonsDir, WPS_ADDON_DIR_NAME)
          },
          namelist: 'abc'
        }
      }),
      'utf8'
    )
    const installer = new WpsAddonInstaller({
      addonSourceDir: path.join(process.cwd(), 'resources', 'wps-addon'),
      jsAddonsDir
    })

    const result = await installer.install()
    expect(result.installed).toBe(true)
    await expect(fs.stat(path.join(jsAddonsDir, WPS_ADDON_DIR_NAME))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(fs.stat(path.join(jsAddonsDir, 'jsaddinblockhost.ini'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    const publish = await fs.readFile(path.join(jsAddonsDir, 'publish.xml'), 'utf8')
    expect(publish).toContain(`url="http://127.0.0.1:${WPS_PREFERRED_SYNC_PORT}/addon/"`)
    expect(publish).toContain('<jspluginonline ')
    expect(publish).toContain('name="ncurator-sync"')
    expect(publish).toContain('enable="enable_dev"')
    expect(
      JSON.parse(await fs.readFile(path.join(jsAddonsDir, WPS_ADDON_PORT_FILE), 'utf8'))
    ).toEqual({
      port: WPS_PREFERRED_SYNC_PORT
    })
    expect(
      JSON.parse(await fs.readFile(path.join(jsAddonsDir, 'authaddin.json'), 'utf8'))
    ).toMatchObject({
      wps: {
        abc: {
          enable: true,
          mode: 2,
          path: `http://127.0.0.1:${WPS_PREFERRED_SYNC_PORT}/addon/`
        },
        namelist: 'abc'
      }
    })

    const authAfterInstall = await fs.readFile(path.join(jsAddonsDir, 'authaddin.json'), 'utf8')
    await installer.writePort(58129)
    expect(
      JSON.parse(await fs.readFile(path.join(jsAddonsDir, WPS_ADDON_PORT_FILE), 'utf8'))
    ).toEqual({
      port: 58129
    })
    const publishAfterFallback = await fs.readFile(path.join(jsAddonsDir, 'publish.xml'), 'utf8')
    expect(publishAfterFallback).toContain(
      `url="http://127.0.0.1:${WPS_PREFERRED_SYNC_PORT}/addon/"`
    )
    expect(publishAfterFallback).not.toContain('58129')
    expect(
      publishXmlHasAddonUrl(publishAfterFallback, toAddonLoopbackUrl(WPS_PREFERRED_SYNC_PORT))
    ).toBe(true)
    expect(await fs.readFile(path.join(jsAddonsDir, 'authaddin.json'), 'utf8')).toBe(
      authAfterInstall
    )
  })

  it('writes the loopback port file without installing', async () => {
    const jsAddonsDir = await createTempDir('ncurator-wps-jsaddons-port-only-')
    const leftoverDir = path.join(jsAddonsDir, WPS_ADDON_NAME)
    await fs.mkdir(leftoverDir, { recursive: true })
    const installer = new WpsAddonInstaller({
      addonSourceDir: path.join(process.cwd(), 'resources', 'wps-addon'),
      jsAddonsDir
    })
    await installer.writePort(WPS_PREFERRED_SYNC_PORT)
    expect(
      JSON.parse(await fs.readFile(path.join(jsAddonsDir, WPS_ADDON_PORT_FILE), 'utf8'))
    ).toEqual({
      port: WPS_PREFERRED_SYNC_PORT
    })
    await expect(fs.stat(leftoverDir)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('office file write notify', () => {
  it('notifies resolved office paths and ignores other files', () => {
    const received: string[] = []
    setOfficeFileWriteListener({
      notifyWritten: (filePath) => received.push(filePath)
    })
    notifyOfficeFileWritten('/tmp/notes.md')
    notifyOfficeFileWritten('/tmp/report.DOCX')
    notifyOfficeFileWritten('/tmp/sheet.XLSX')
    notifyOfficeFileWritten('/tmp/deck.PPTX')
    expect(received).toEqual([
      path.resolve('/tmp/report.DOCX'),
      path.resolve('/tmp/sheet.XLSX'),
      path.resolve('/tmp/deck.PPTX')
    ])
  })

  it('closes an open office file before write and reopens after failure', async () => {
    const events: string[] = []
    const reportPath = path.resolve('/tmp/report.docx')
    setOfficeFileWriteListener({
      prepareClose: async (filePath) => {
        events.push(`close:${filePath}`)
        return true
      },
      notifyWritten: (filePath) => {
        events.push(`open:${filePath}`)
      }
    })
    await expect(
      withOfficeFileWrite(reportPath, async () => {
        events.push('write')
        throw new Error('write failed')
      })
    ).rejects.toThrow('write failed')
    expect(events).toEqual([`close:${reportPath}`, 'write', `open:${reportPath}`])
  })

  it('treats a missing office file as unlocked', async () => {
    await expect(
      waitForOfficePathUnlocked(path.join(os.tmpdir(), 'ncurator-missing-office.docx'), 200)
    ).resolves.toBeUndefined()
  })
})

describe('WpsOpenDocumentRegistry', () => {
  it('matches open documents across path separators and case', () => {
    const registry = new WpsOpenDocumentRegistry()
    registry.setDocuments('client-a', 'wps', [
      { name: 'a.docx', fullName: '/Users/Me/Docs/A.docx' }
    ])
    expect(registry.isOpen('/Users/Me/Docs/A.docx')).toBe(true)
    expect(registry.isOpen('/users/me/docs/a.docx')).toBe(true)
    expect(registry.isOpen('/Users/Me/Docs/other.docx')).toBe(false)
    expect(registry.listOpenDocuments()).toEqual([
      { clientId: 'client-a', component: 'wps', fullName: '/Users/Me/Docs/A.docx' }
    ])
    registry.remove('/users/me/docs/a.docx')
    expect(registry.isOpen('/Users/Me/Docs/A.docx')).toBe(false)
    registry.upsert('client-a', 'wps', '/Users/Me/Docs/A.docx')
    expect(registry.isOpen('/users/me/docs/a.docx')).toBe(true)
    expect(registry.componentFor('/Users/Me/Docs/A.docx')).toBe('wps')
    expect(registry.clientFor('/Users/Me/Docs/A.docx')).toBe('client-a')
  })

  it('keeps each add-in instance of the same component separate', () => {
    const registry = new WpsOpenDocumentRegistry()
    registry.setDocuments('stale-et', 'et', [{ name: 'old.xlsx', fullName: '/old/run/sheet.xlsx' }])
    registry.setDocuments('live-et', 'et', [{ name: 'new.xlsx', fullName: '/new/run/sheet.xlsx' }])

    // 旧实例上报文档列表不得把新实例的文档顶掉，否则 close / open 会投错人。
    expect(registry.isOpen('/old/run/sheet.xlsx')).toBe(true)
    expect(registry.isOpen('/new/run/sheet.xlsx')).toBe(true)
    expect(registry.clientFor('/new/run/sheet.xlsx')).toBe('live-et')
    expect(registry.clientFor('/old/run/sheet.xlsx')).toBe('stale-et')

    registry.dropClient('stale-et')
    expect(registry.isOpen('/old/run/sheet.xlsx')).toBe(false)
    expect(registry.isOpen('/new/run/sheet.xlsx')).toBe(true)
  })
})

describe('WpsSyncService', () => {
  const platform = process.platform
  beforeEach(() => {
    // Exercise the add-in reopen protocol independently from macOS file handoff.
    if (platform === 'darwin') Object.defineProperty(process, 'platform', { value: 'linux' })
  })
  afterEach(() => Object.defineProperty(process, 'platform', { value: platform }))

  it('hands atomically replaced macOS documents to WPS without calling the native Open API', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    const openPath = vi.spyOn(shell, 'openPath').mockResolvedValue('')
    const service = new WpsSyncService({
      readAvailability: async () => 'enabled',
      skipInstall: true,
      preferredPort: 0
    })
    services.push(service)
    await service.start()
    const port = service.getPort()!
    const stream = readSseEvents(port, 'et')
    await waitFor(() => stream.events.some((event) => event.type === 'ping'))
    await reportOpenItems(port, {
      component: 'et',
      clientId: stream.clientId,
      fullNames: ['/tmp/mac.xlsx']
    })
    const closing = service.prepareClose('/tmp/mac.xlsx')
    await waitFor(() => stream.events.some((event) => event.type === 'close'))
    await postReport(port, {
      kind: 'close-result',
      component: 'et',
      clientId: stream.clientId,
      data: { ok: true, fullName: '/tmp/mac.xlsx', remaining: 0, placeholder: true }
    })
    expect(await closing).toBe(true)
    service.notifyWritten('/tmp/mac.xlsx')
    await expectShellReopen('/tmp/mac.xlsx', 'et')
    expect(stream.events.some((event) => event.type === 'open')).toBe(false)
    await reportOpenItems(port, {
      component: 'et',
      clientId: stream.clientId,
      fullNames: ['/tmp/mac.xlsx']
    })
    await waitFor(() => stream.events.some((event) => event.type === 'excerpt'))
    stream.close()
    openPath.mockRestore()
  })
  it('skips listening when WPS is not installed', async () => {
    const service = new WpsSyncService({
      readAvailability: async () => 'enabled',
      skipInstall: false,
      installer: {
        install: async () => ({ installed: false, reason: 'wps-jsaddons-missing' }),
        writePort: async () => undefined
      }
    })
    services.push(service)
    await service.start()
    expect(service.getPort()).toBeUndefined()
  })

  it('closes an open document then opens it after write', async () => {
    const addonDir = await createTempDir('ncurator-wps-addon-dir-')
    const service = new WpsSyncService({
      readAvailability: async () => 'enabled',
      skipInstall: false,
      preferredPort: 0,
      installer: {
        install: async () => ({ installed: true, addonDir }),
        writePort: async () => undefined
      }
    })
    services.push(service)
    await service.start()
    const port = service.getPort()
    expect(port).toBeTruthy()

    const stream = readSseEvents(port as number)
    await waitFor(() => stream.events.some((event) => event.type === 'ping'))

    await reportOpenItems(port as number, {
      component: 'wps',
      clientId: stream.clientId,
      fullNames: ['/tmp/opened.docx']
    })
    expect(service.getOpenRegistry().isOpen('/tmp/opened.docx')).toBe(true)

    const closing = service.prepareClose('/tmp/opened.docx')
    await waitFor(() => stream.events.some((event) => event.type === 'close'))
    await postReport(port as number, {
      kind: 'close-result',
      component: 'wps',
      clientId: stream.clientId,
      data: {
        ok: true,
        fullName: '/tmp/opened.docx',
        remaining: 1
      }
    })
    expect(await closing).toBe(true)
    expect(service.getOpenRegistry().isOpen('/tmp/opened.docx')).toBe(false)

    const openPath = vi.spyOn(shell, 'openPath').mockResolvedValue('')
    service.notifyWritten('/tmp/opened.docx')
    await waitFor(() => stream.events.some((event) => event.type === 'open'), 3_500)
    expect(
      stream.events.some(
        (event) => event.type === 'open' && event.path === path.resolve('/tmp/opened.docx')
      )
    ).toBe(true)
    expect(openPath).not.toHaveBeenCalled()
    expect(vi.mocked(spawn)).not.toHaveBeenCalled()
    stream.close()
    openPath.mockRestore()
  })

  it('treats add-in disconnect during close as released', async () => {
    const addonDir = await createTempDir('ncurator-wps-addon-dir-')
    const service = new WpsSyncService({
      readAvailability: async () => 'enabled',
      skipInstall: false,
      preferredPort: 0,
      installer: {
        install: async () => ({ installed: true, addonDir }),
        writePort: async () => undefined
      }
    })
    services.push(service)
    await service.start()
    const port = service.getPort()
    expect(port).toBeTruthy()

    const stream = readSseEvents(port as number)
    await waitFor(() => stream.events.some((event) => event.type === 'ping'))
    await reportOpenItems(port as number, {
      component: 'wps',
      clientId: stream.clientId,
      fullNames: ['/tmp/opened.docx']
    })
    const closing = service.prepareClose('/tmp/opened.docx')
    await waitFor(() => stream.events.some((event) => event.type === 'close'))
    stream.close()
    expect(await closing).toBe(true)
    expect(service.getOpenRegistry().isOpen('/tmp/opened.docx')).toBe(false)
  })

  it('refuses to write when the add-in reports the close failed', async () => {
    const addonDir = await createTempDir('ncurator-wps-addon-dir-')
    const service = new WpsSyncService({
      readAvailability: async () => 'enabled',
      skipInstall: false,
      preferredPort: 0,
      installer: {
        install: async () => ({ installed: true, addonDir }),
        writePort: async () => undefined
      }
    })
    services.push(service)
    await service.start()
    const port = service.getPort() as number

    const stream = readSseEvents(port)
    await waitFor(() => stream.events.some((event) => event.type === 'ping'))
    await reportOpenItems(port, {
      component: 'wps',
      clientId: stream.clientId,
      fullNames: ['/tmp/opened.docx']
    })

    const closing = service.prepareClose('/tmp/opened.docx')
    await waitFor(() => stream.events.some((event) => event.type === 'close'))
    await postReport(port, {
      kind: 'close-result',
      component: 'wps',
      clientId: stream.clientId,
      data: {
        ok: false,
        reason: 'still open after close',
        targetPath: '/tmp/opened.docx',
        remaining: 1
      }
    })
    // 文档还开着就写盘会让窗口显示旧稿而磁盘已变，必须让写入方知道没释放。
    expect(await closing).toBe(false)
    expect(service.getOpenRegistry().isOpen('/tmp/opened.docx')).toBe(true)
    stream.close()
  })

  it('sends close and open only to the add-in instance holding the document', async () => {
    const addonDir = await createTempDir('ncurator-wps-addon-dir-')
    const openPath = vi.spyOn(shell, 'openPath').mockResolvedValue('')
    const service = new WpsSyncService({
      readAvailability: async () => 'enabled',
      skipInstall: false,
      preferredPort: 0,
      installer: {
        install: async () => ({ installed: true, addonDir }),
        writePort: async () => undefined
      }
    })
    services.push(service)
    await service.start()
    const port = service.getPort() as number

    const stale = readSseEvents(port, 'et', 'stale-et')
    const live = readSseEvents(port, 'et', 'live-et')
    await waitFor(() => stale.events.some((event) => event.type === 'ping'))
    await waitFor(() => live.events.some((event) => event.type === 'ping'))
    await reportOpenItems(port, {
      component: 'et',
      clientId: 'stale-et',
      fullNames: ['/old/run/sheet.xlsx']
    })
    await reportOpenItems(port, {
      component: 'et',
      clientId: 'live-et',
      fullNames: ['/new/run/sheet.xlsx']
    })

    const closing = service.prepareClose('/new/run/sheet.xlsx')
    await waitFor(() => live.events.some((event) => event.type === 'close'))
    expect(stale.events.some((event) => event.type === 'close')).toBe(false)
    await postReport(port, {
      kind: 'close-result',
      component: 'et',
      clientId: 'live-et',
      data: { ok: true, fullName: '/new/run/sheet.xlsx', remaining: 1 }
    })
    expect(await closing).toBe(true)

    service.notifyWritten('/new/run/sheet.xlsx')
    await waitFor(() =>
      live.events.some(
        (event) => event.type === 'open' && event.path === path.resolve('/new/run/sheet.xlsx')
      )
    )
    expect(stale.events.some((event) => event.type === 'open')).toBe(false)

    // 旁边的实例说打不开不能算数，否则会把正在干活的实例踢去走系统重开。
    await postReport(port, {
      kind: 'reload-result',
      component: 'et',
      clientId: 'stale-et',
      data: { ok: false, reason: 'not open here', targetPath: '/new/run/sheet.xlsx' }
    })
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(vi.mocked(spawn)).not.toHaveBeenCalled()
    expect(openPath).not.toHaveBeenCalled()

    stale.close()
    live.close()
    openPath.mockRestore()
  })

  it('drops an instance documents when its stream disconnects', async () => {
    const addonDir = await createTempDir('ncurator-wps-addon-dir-')
    const service = new WpsSyncService({
      readAvailability: async () => 'enabled',
      skipInstall: false,
      preferredPort: 0,
      installer: {
        install: async () => ({ installed: true, addonDir }),
        writePort: async () => undefined
      }
    })
    services.push(service)
    await service.start()
    const port = service.getPort() as number

    const stream = readSseEvents(port, 'wpp', 'ghost-wpp')
    await waitFor(() => stream.events.some((event) => event.type === 'ping'))
    await reportOpenItems(port, {
      component: 'wpp',
      clientId: 'ghost-wpp',
      fullNames: ['/tmp/deck.pptx']
    })
    expect(service.getOpenRegistry().isOpen('/tmp/deck.pptx')).toBe(true)

    stream.close()
    await waitFor(() => !service.getOpenRegistry().isOpen('/tmp/deck.pptx'))
    expect(service.getOpenRegistry().listOpenDocuments()).toEqual([])
  })

  it('flushes a pending excerpt when the add-in reconnects after last-document close', async () => {
    const addonDir = await createTempDir('ncurator-wps-addon-dir-')
    const openPath = vi.spyOn(shell, 'openPath').mockResolvedValue('')
    const service = new WpsSyncService({
      readAvailability: async () => 'enabled',
      skipInstall: false,
      preferredPort: 0,
      installer: {
        install: async () => ({ installed: true, addonDir }),
        writePort: async () => undefined
      }
    })
    services.push(service)
    await service.start()
    const port = service.getPort()
    expect(port).toBeTruthy()

    const first = readSseEvents(port as number)
    await waitFor(() => first.events.some((event) => event.type === 'ping'))
    await reportOpenItems(port as number, {
      component: 'wps',
      clientId: first.clientId,
      fullNames: ['/tmp/opened.docx']
    })
    const closing = service.prepareClose('/tmp/opened.docx')
    await waitFor(() => first.events.some((event) => event.type === 'close'))
    await postReport(port as number, {
      kind: 'close-result',
      component: 'wps',
      clientId: first.clientId,
      data: { ok: true, fullName: '/tmp/opened.docx', remaining: 0, placeholder: false }
    })
    expect(await closing).toBe(true)
    first.close()
    await waitFor(async () => {
      const status = (await (await fetch(`http://127.0.0.1:${port}/status`)).json()) as {
        clientCount: number
      }
      return status.clientCount === 0
    })

    service.notifyWritten('/tmp/opened.docx')
    await expectShellReopen('/tmp/opened.docx', 'wps')

    const second = readSseEvents(port as number)
    await waitFor(() => second.events.some((event) => event.type === 'ping'))
    expect(second.events.some((event) => event.type === 'open')).toBe(false)
    await reportOpenItems(port as number, {
      component: 'wps',
      clientId: second.clientId,
      fullNames: ['/tmp/opened.docx']
    })
    await waitFor(() =>
      second.events.some(
        (event) => event.type === 'excerpt' && event.path === path.resolve('/tmp/opened.docx')
      )
    )
    second.close()
    openPath.mockRestore()
  })

  it('reopens through the system when the closed document was the last of its component', async () => {
    const addonDir = await createTempDir('ncurator-wps-addon-dir-')
    const openPath = vi.spyOn(shell, 'openPath').mockResolvedValue('')
    const service = new WpsSyncService({
      readAvailability: async () => 'enabled',
      skipInstall: false,
      preferredPort: 0,
      installer: {
        install: async () => ({ installed: true, addonDir }),
        writePort: async () => undefined
      }
    })
    services.push(service)
    await service.start()
    const port = service.getPort()
    expect(port).toBeTruthy()

    const stream = readSseEvents(port as number, 'et')
    await waitFor(() => stream.events.some((event) => event.type === 'ping'))
    await reportOpenItems(port as number, {
      component: 'et',
      clientId: stream.clientId,
      fullNames: ['/tmp/sheet.xlsx']
    })
    const closing = service.prepareClose('/tmp/sheet.xlsx')
    await waitFor(() => stream.events.some((event) => event.type === 'close'))
    await postReport(port as number, {
      kind: 'close-result',
      component: 'et',
      clientId: stream.clientId,
      data: { ok: true, fullName: '/tmp/sheet.xlsx', remaining: 0, placeholder: false }
    })
    expect(await closing).toBe(true)

    // SSE 仍连着，但加载项自报已无文档且没能建占位，必须走系统打开而不是发 open。
    service.notifyWritten('/tmp/sheet.xlsx')
    await expectShellReopen('/tmp/sheet.xlsx', 'et')
    expect(stream.events.some((event) => event.type === 'open')).toBe(false)
    expect(vi.mocked(spawn).mock.calls.length + openPath.mock.calls.length).toBe(1)

    await waitFor(() => stream.events.some((event) => event.type === 'list'), 3_000)
    await reportOpenItems(port as number, {
      component: 'et',
      clientId: stream.clientId,
      fullNames: ['/tmp/sheet.xlsx']
    })
    await waitFor(() =>
      stream.events.some(
        (event) => event.type === 'excerpt' && event.path === path.resolve('/tmp/sheet.xlsx')
      )
    )
    expect(vi.mocked(spawn).mock.calls.length + openPath.mock.calls.length).toBe(1)
    stream.close()
    openPath.mockRestore()
  })

  it('keeps using the add-in when a placeholder document held the component alive', async () => {
    const addonDir = await createTempDir('ncurator-wps-addon-dir-')
    const openPath = vi.spyOn(shell, 'openPath').mockResolvedValue('')
    const service = new WpsSyncService({
      readAvailability: async () => 'enabled',
      skipInstall: false,
      preferredPort: 0,
      installer: {
        install: async () => ({ installed: true, addonDir }),
        writePort: async () => undefined
      }
    })
    services.push(service)
    await service.start()
    const port = service.getPort() as number

    const stream = readSseEvents(port, 'et')
    await waitFor(() => stream.events.some((event) => event.type === 'ping'))
    await reportOpenItems(port, {
      component: 'et',
      clientId: stream.clientId,
      fullNames: ['/tmp/sheet.xlsx']
    })
    const closing = service.prepareClose('/tmp/sheet.xlsx')
    await waitFor(() => stream.events.some((event) => event.type === 'close'))
    await postReport(port, {
      kind: 'close-result',
      component: 'et',
      clientId: stream.clientId,
      data: { ok: true, fullName: '/tmp/sheet.xlsx', remaining: 0, placeholder: true }
    })
    expect(await closing).toBe(true)

    // 占位文档撑住了进程，加载项还能执行 Open，不该退化成系统重开。
    service.notifyWritten('/tmp/sheet.xlsx')
    await waitFor(() =>
      stream.events.some(
        (event) => event.type === 'open' && event.path === path.resolve('/tmp/sheet.xlsx')
      )
    )
    expect(vi.mocked(spawn)).not.toHaveBeenCalled()
    expect(openPath).not.toHaveBeenCalled()
    stream.close()
    openPath.mockRestore()
  })

  it('falls back to the system open when the add-in reports the open failed', async () => {
    const addonDir = await createTempDir('ncurator-wps-addon-dir-')
    const openPath = vi.spyOn(shell, 'openPath').mockResolvedValue('')
    const service = new WpsSyncService({
      readAvailability: async () => 'enabled',
      skipInstall: false,
      preferredPort: 0,
      installer: {
        install: async () => ({ installed: true, addonDir }),
        writePort: async () => undefined
      }
    })
    services.push(service)
    await service.start()
    const port = service.getPort()
    expect(port).toBeTruthy()

    const stream = readSseEvents(port as number, 'et')
    await waitFor(() => stream.events.some((event) => event.type === 'ping'))
    await reportOpenItems(port as number, {
      component: 'et',
      clientId: stream.clientId,
      fullNames: ['/tmp/sheet.xlsx']
    })
    const closing = service.prepareClose('/tmp/sheet.xlsx')
    await waitFor(() => stream.events.some((event) => event.type === 'close'))
    await postReport(port as number, {
      kind: 'close-result',
      component: 'et',
      clientId: stream.clientId,
      data: { ok: true, fullName: '/tmp/sheet.xlsx', remaining: 2 }
    })
    expect(await closing).toBe(true)

    service.notifyWritten('/tmp/sheet.xlsx')
    await waitFor(() =>
      stream.events.some(
        (event) => event.type === 'open' && event.path === path.resolve('/tmp/sheet.xlsx')
      )
    )
    expect(vi.mocked(spawn)).not.toHaveBeenCalled()
    expect(openPath).not.toHaveBeenCalled()

    await postReport(port as number, {
      kind: 'reload-result',
      component: 'et',
      clientId: stream.clientId,
      data: { ok: false, reason: 'Workbooks unavailable', targetPath: '/tmp/sheet.xlsx' }
    })
    await expectShellReopen('/tmp/sheet.xlsx', 'et')
    expect(vi.mocked(spawn).mock.calls.length + openPath.mock.calls.length).toBe(1)
    stream.close()
    openPath.mockRestore()
  })

  it('registers a successful reload-result so the next close can find the document', async () => {
    const addonDir = await createTempDir('ncurator-wps-addon-dir-')
    const service = new WpsSyncService({
      readAvailability: async () => 'enabled',
      skipInstall: false,
      preferredPort: 0,
      installer: {
        install: async () => ({ installed: true, addonDir }),
        writePort: async () => undefined
      }
    })
    services.push(service)
    await service.start()
    const port = service.getPort()
    expect(port).toBeTruthy()
    expect(service.getOpenRegistry().isOpen('/tmp/opened.docx')).toBe(false)

    await postReport(port as number, {
      kind: 'reload-result',
      component: 'wps',
      clientId: 'writer-1',
      data: {
        ok: true,
        fullName: '/tmp/opened.docx',
        excerpt: 'hello',
        items: [{ name: 'a.docx', fullName: '/tmp/opened.docx' }]
      }
    })
    expect(service.getOpenRegistry().isOpen('/tmp/opened.docx')).toBe(true)
    expect(service.getOpenRegistry().componentFor('/tmp/opened.docx')).toBe('wps')
    expect(service.getOpenRegistry().clientFor('/tmp/opened.docx')).toBe('writer-1')
  })

  it('sends open only to the matching office component', async () => {
    const addonDir = await createTempDir('ncurator-wps-addon-dir-')
    const service = new WpsSyncService({
      readAvailability: async () => 'enabled',
      skipInstall: false,
      preferredPort: 0,
      installer: {
        install: async () => ({ installed: true, addonDir }),
        writePort: async () => undefined
      }
    })
    services.push(service)
    await service.start()
    const port = service.getPort()
    expect(port).toBeTruthy()

    const word = readSseEvents(port as number, 'wps')
    const excel = readSseEvents(port as number, 'et')
    await waitFor(() => word.events.some((event) => event.type === 'ping'))
    await waitFor(() => excel.events.some((event) => event.type === 'ping'))
    await reportOpenItems(port as number, {
      component: 'wps',
      clientId: word.clientId,
      fullNames: ['/tmp/opened.docx']
    })
    service.notifyWritten('/tmp/opened.docx')
    await waitFor(() =>
      word.events.some(
        (event) => event.type === 'open' && event.path === path.resolve('/tmp/opened.docx')
      )
    )
    expect(excel.events.some((event) => event.type === 'open')).toBe(false)
    word.close()
    excel.close()
  })

  it('broadcasts open to connected add-ins after an office file write', async () => {
    const addonDir = await createTempDir('ncurator-wps-addon-dir-')
    let writtenPort: number | undefined
    const service = new WpsSyncService({
      readAvailability: async () => 'enabled',
      skipInstall: false,
      preferredPort: 0,
      installer: {
        install: async () => ({ installed: true, addonDir }),
        writePort: async (port) => {
          writtenPort = port
        }
      }
    })
    services.push(service)
    await service.start()
    const port = service.getPort()
    expect(port).toBeTruthy()
    expect(writtenPort).toBe(port)

    const stream = readSseEvents(port as number)
    await waitFor(() => stream.events.some((event) => event.type === 'ping'))

    await reportOpenItems(port as number, {
      component: 'wps',
      clientId: stream.clientId,
      fullNames: ['/tmp/opened.docx']
    })
    expect(service.getOpenRegistry().isOpen('/tmp/opened.docx')).toBe(true)

    service.notifyWritten('/tmp/opened.docx')
    await waitFor(() => stream.events.some((event) => event.type === 'open'))
    expect(
      stream.events.some(
        (event) => event.type === 'open' && event.path === path.resolve('/tmp/opened.docx')
      )
    ).toBe(true)
    stream.close()
  })

  it('records dispatches on GET /status even without connected add-ins', async () => {
    const addonDir = await createTempDir('ncurator-wps-addon-dir-')
    const service = new WpsSyncService({
      readAvailability: async () => 'enabled',
      skipInstall: false,
      preferredPort: 0,
      installer: {
        install: async () => ({ installed: true, addonDir }),
        writePort: async () => undefined
      }
    })
    services.push(service)
    await service.start()
    const port = service.getPort()
    expect(port).toBeTruthy()

    service.notifyWritten('/tmp/opened.docx')
    await postReport(port as number, {
      kind: 'reload-result',
      component: 'wps',
      clientId: 'writer-1',
      at: 1_700_000_000_000,
      data: {
        ok: false,
        reason: 'not open here',
        targetPath: '/tmp/opened.docx'
      }
    })

    const status = (await (await fetch(`http://127.0.0.1:${port}/status`)).json()) as {
      clientCount: number
      lastDispatches: Array<{ path: string; clientCount: number }>
      lastReloadResults: Array<{ ok: boolean; reason?: string; targetPath?: string }>
    }
    expect(status.clientCount).toBe(0)
    expect(status.lastDispatches).toEqual([
      {
        path: path.resolve('/tmp/opened.docx'),
        at: expect.any(Number),
        clientCount: 0
      }
    ])
    expect(status.lastReloadResults).toEqual([
      {
        at: 1_700_000_000_000,
        component: 'wps',
        clientId: 'writer-1',
        ok: false,
        fullName: '',
        excerpt: '',
        reason: 'not open here',
        targetPath: '/tmp/opened.docx'
      }
    ])
  })

  it('starts the loopback server without installing when skipInstall is set', async () => {
    const install = vi.fn(async () => ({ installed: false as const }))
    const writePort = vi.fn(async () => undefined)
    const service = new WpsSyncService({
      readAvailability: async () => 'enabled',
      skipInstall: true,
      preferredPort: 0,
      installer: { install, writePort }
    })
    services.push(service)
    await service.start()
    expect(service.getPort()).toBeTruthy()
    expect(install).not.toHaveBeenCalled()
    expect(writePort).toHaveBeenCalledWith(service.getPort())
    const port = service.getPort()
    const ribbon = await fetch(`http://127.0.0.1:${port}/addon/ribbon.xml`)
    expect(ribbon.ok).toBe(true)
    expect(await ribbon.text()).toContain('label="馆长"')
    const rootRibbon = await fetch(`http://127.0.0.1:${port}/ribbon.xml`)
    expect(rootRibbon.ok).toBe(true)
    const portFile = (await (await fetch(`http://127.0.0.1:${port}/addon/port.json`)).json()) as {
      port: number
    }
    expect(portFile.port).toBe(port)
    const status = (await (await fetch(`http://127.0.0.1:${port}/status`)).json()) as {
      lastAddonFetches: Array<{ path: string }>
    }
    expect(status.lastAddonFetches.some((item) => item.path === '/ribbon.xml')).toBe(true)
    expect(status.lastAddonFetches.some((item) => item.path === '/port.json')).toBe(true)
  })

  it('starts a fallback observer server and restores the live preferred port on stop', async () => {
    const first = new WpsSyncService({
      readAvailability: async () => 'enabled',
      skipInstall: true,
      preferredPort: 0,
      installer: {
        install: async () => ({ installed: true }),
        writePort: async () => undefined
      }
    })
    services.push(first)
    await first.start()
    const livePort = first.getPort()
    expect(livePort).toBeTruthy()

    const writePort = vi.fn(async () => undefined)
    const second = new WpsSyncService({
      readAvailability: async () => 'enabled',
      skipInstall: true,
      preferredPort: livePort,
      installer: {
        install: async () => ({ installed: true }),
        writePort
      }
    })
    services.push(second)
    await second.start()
    const fallbackPort = second.getPort()
    expect(fallbackPort).toBeTruthy()
    expect(fallbackPort).not.toBe(livePort)
    expect(writePort).toHaveBeenCalledWith(fallbackPort)
    expect(
      ((await (await fetch(`http://127.0.0.1:${livePort}/status`)).json()) as { ok: boolean }).ok
    ).toBe(true)

    await second.stop()
    expect(writePort).toHaveBeenCalledWith(livePort)
  })

  it('does not bind a fallback when a production instance finds the preferred port already serving', async () => {
    const first = new WpsSyncService({
      readAvailability: async () => 'enabled',
      skipInstall: true,
      preferredPort: 0,
      installer: {
        install: async () => ({ installed: true }),
        writePort: async () => undefined
      }
    })
    services.push(first)
    await first.start()
    const livePort = first.getPort()
    expect(livePort).toBeTruthy()

    const writePort = vi.fn(async () => undefined)
    const second = new WpsSyncService({
      readAvailability: async () => 'enabled',
      skipInstall: false,
      preferredPort: livePort,
      installer: {
        install: async () => ({ installed: true }),
        writePort
      }
    })
    services.push(second)
    await second.start()
    expect(second.getPort()).toBeUndefined()
    expect(writePort).toHaveBeenCalledWith(livePort)
  })
})

describe('WPS review navigation', () => {
  it('routes a separate navigate command to the document owner and correlates the acknowledgement', async () => {
    const service = new WpsSyncService({
      readAvailability: async () => 'enabled',
      skipInstall: true,
      preferredPort: 0
    })
    services.push(service)
    await service.start()
    const port = service.getPort()!
    const owner = readSseEvents(port, 'wps', 'review-owner'),
      other = readSseEvents(port, 'wps', 'review-other')
    await waitFor(() => owner.events.length > 0 && other.events.length > 0)
    await reportOpenItems(port, {
      component: 'wps',
      clientId: owner.clientId,
      fullNames: ['/tmp/review.docx']
    })
    const open = vi.fn(async () => undefined)
    const navigating = service.navigate(
      '/tmp/review.docx',
      {
        kind: 'docx',
        part: 'word/document.xml',
        paragraph: 1,
        text: 'changed',
        previous: '',
        next: '',
        container: false
      },
      open
    )
    await waitFor(() => owner.events.some((e) => e.type === 'navigate'))
    const command = owner.events.find((e) => e.type === 'navigate')!
    expect(other.events.some((e) => e.type === 'navigate')).toBe(false)
    expect(owner.events.some((e) => e.type === 'close' || e.type === 'open')).toBe(false)
    expect(open).not.toHaveBeenCalled()
    await postReport(port, {
      kind: 'navigate-result',
      component: 'wps',
      clientId: owner.clientId,
      data: { requestId: command.requestId, fullName: '/tmp/review.docx', status: 'located' }
    })
    expect(await navigating).toEqual({ status: 'located', reason: undefined })
    const status = await (await fetch(`http://127.0.0.1:${port}/status`)).json()
    expect(status.lastNavigationResults.at(-1)).toMatchObject({
      status: 'located',
      fullName: '/tmp/review.docx'
    })
    owner.close()
    other.close()
  })
})

const startReviewAddon = async (app: object, host: 'wps' | 'et' | 'wpp') => {
  const { runInNewContext } = await import('node:vm')
  const source = await fs.readFile(path.join(process.cwd(), 'resources/wps-addon/main.js'), 'utf8')
  const reports: Array<{
    kind: string
    data: {
      status?: string
      selection?: OfficeReviewSelection
      reason?: string
      ok?: boolean
      excerpt?: string
      fullName?: string
    }
  }> = []
  const stream: { onmessage?: (event: { data: string }) => void; close: () => void } = {
    close: () => undefined
  }
  class Xhr {
    status = 200
    responseText = '{"port":18723}'
    onload?: () => void
    open() {}
    setRequestHeader() {}
    send() {
      this.onload?.()
    }
  }
  const window = {
    Application: app,
    location: { search: `?host=${host}`, hash: '' },
    OnAddinLoad: () => true
  }
  runInNewContext(source, {
    window,
    XMLHttpRequest: Xhr,
    EventSource: function () {
      return stream
    },
    setTimeout: () => 0,
    clearTimeout: () => undefined,
    fetch: (_url: string, options: { body: string }) => {
      reports.push(JSON.parse(options.body))
      return Promise.resolve({})
    }
  })
  window.OnAddinLoad()
  return { reports, stream }
}

describe('WPS add-in review selection', () => {
  it('reads the reopened Writer document through paragraph ranges when aggregate text is empty', async () => {
    const target = {
      Name: 'target.docx',
      FullName: '/tmp/target.docx',
      Saved: true,
      Activate: vi.fn(),
      Close: vi.fn<() => void>(),
      Content: {
        Text: '',
        Paragraphs: {
          Count: 2,
          Item: (index: number) => ({ Range: { Text: ['before\r', 'fresh marker\r'][index - 1] } })
        }
      }
    }
    const other = {
      ...target,
      Name: 'other.docx',
      FullName: '/tmp/other.docx',
      Content: { ...target.Content, Text: 'unrelated document' }
    }
    const documents = [target, other]
    target.Close.mockImplementation(() => {
      documents.splice(documents.indexOf(target), 1)
    })
    const app = {
      Name: 'WPS Writer',
      ActiveDocument: other,
      ActiveWindow: { ActivePane: { VerticalPercentScrolled: 0 } },
      Selection: { Start: 0, SetRange: vi.fn() },
      Documents: {
        get Count() {
          return documents.length
        },
        Item: (index: number) => documents[index - 1],
        Open: vi.fn(() => {
          documents.unshift(target)
          return target
        })
      }
    }
    const { reports, stream } = await startReviewAddon(app, 'wps')
    stream.onmessage?.({ data: JSON.stringify({ type: 'close', path: target.FullName }) })
    stream.onmessage?.({ data: JSON.stringify({ type: 'open', path: target.FullName }) })
    expect(reports.at(-1)).toMatchObject({
      kind: 'reload-result',
      data: { ok: true, fullName: target.FullName, excerpt: 'before\rfresh marker\r' }
    })
    expect(target.Activate).toHaveBeenCalledOnce()
    stream.onmessage?.({ data: JSON.stringify({ type: 'excerpt', path: target.FullName }) })
    expect(reports.at(-1)?.data.excerpt).toBe('before\rfresh marker\r')
  })

  it('uses the ET Address method and preserves a dirty workbook without selecting old coordinates', async () => {
    let dirty = false
    const range = {
      Row: 2,
      Column: 2,
      Formula: '',
      Value2: 'edited',
      Text: 'edited',
      Address: () => 'B2',
      Select: vi.fn()
    }
    const sheet = {
      Name: 'Data',
      Range: () => range,
      Cells: {
        Item: (_row: number, column: number) => ({
          ...range,
          Column: column,
          Address: () => (column === 2 ? 'B2' : 'C2')
        })
      },
      Activate: vi.fn()
    }
    const found = { Row: 2, Column: 2, Address: () => 'B2' }
    const find = vi.fn(() => found)
    Object.assign(sheet, { UsedRange: { Find: find } })
    const item = {
      FullName: '/tmp/review.xlsx',
      Name: 'review.xlsx',
      get Saved() {
        return !dirty
      },
      set Saved(_value: boolean) {
        throw new Error('must not assign Saved')
      },
      Worksheets: { Item: () => sheet },
      Activate: vi.fn(),
      Close: vi.fn(),
      Save: vi.fn()
    }
    const app = {
      Name: 'WPS Spreadsheets',
      Workbooks: { Count: 1, Item: () => item, Open: vi.fn() },
      ActiveWorkbook: item,
      ActiveSheet: sheet,
      ActiveWindow: {},
      Selection: { Address: vi.fn(() => '$B$2') },
      Goto: vi.fn()
    }
    const { reports, stream } = await startReviewAddon(app, 'et')
    const command = {
      type: 'navigate',
      requestId: 'et-selection',
      path: item.FullName,
      target: { kind: 'excel', sheet: 'Data', address: 'B2', value: 'edited', container: false }
    }
    stream.onmessage?.({ data: JSON.stringify(command) })
    expect(reports.at(-1)).toMatchObject({
      kind: 'navigate-result',
      data: { status: 'located', selection: { kind: 'excel', sheet: 'Data', address: '$B$2' } }
    })
    expect(app.Selection.Address).toHaveBeenCalledWith(false, false)
    dirty = true
    range.Select.mockClear()
    stream.onmessage?.({ data: JSON.stringify({ ...command, requestId: 'et-dirty' }) })
    expect(reports.at(-1)?.data).toMatchObject({ status: 'located' })
    expect(find).toHaveBeenCalledTimes(4)
    find
      .mockReturnValueOnce(found)
      .mockImplementationOnce(() => ({ Row: 2, Column: 3, Address: () => 'C2' }))
    range.Select.mockClear()
    stream.onmessage?.({ data: JSON.stringify({ ...command, requestId: 'et-dirty-duplicate' }) })
    expect(reports.at(-1)?.data).toMatchObject({ status: 'opened' })
    expect(reports.at(-1)?.data.reason).toContain('多处相同')
    expect(range.Select).not.toHaveBeenCalled()
    expect(item.Saved).toBe(false)
    expect(item.Close).not.toHaveBeenCalled()
    expect(item.Save).not.toHaveBeenCalled()
    expect(app.Workbooks.Open).not.toHaveBeenCalled()
  })

  it('recovers moved Excel cells using row and column anchors, including zero and changed values', async () => {
    const values = new Map<string, string | number>([
      ['4:3', 0],
      ['4:2', 'account-a'],
      ['3:3', 'revenue'],
      ['9:3', 0]
    ])
    let selected = ''
    const makeCell = (row: number, column: number) => ({
      Row: row,
      Column: column,
      get Value2() {
        return values.get(`${row}:${column}`) ?? ''
      },
      Formula: '',
      get Text() {
        return String(this.Value2)
      },
      Address: () => `${String.fromCharCode(64 + column)}${row}`,
      Select() {
        selected = this.Address()
      }
    })
    const sheet = {
      Name: 'Data',
      Cells: { Item: makeCell },
      Activate: vi.fn(),
      Range: () => makeCell(2, 2),
      UsedRange: {
        Find: (what: string, after?: ReturnType<typeof makeCell>) => {
          const matching = [...values.entries()]
            .filter(([, value]) => String(value) === what)
            .map(([key]) => {
              const [row, column] = key.split(':').map(Number)
              return makeCell(row, column)
            })
          if (!matching.length) return null
          const previous = matching.findIndex((cell) => cell.Address() === after?.Address())
          return matching[(previous + 1) % matching.length]
        }
      }
    }
    const item = {
      FullName: '/tmp/moved.xlsx',
      Name: 'moved.xlsx',
      Saved: false,
      Worksheets: { Item: () => sheet },
      Activate: vi.fn(),
      Close: vi.fn(),
      Save: vi.fn()
    }
    const app = {
      Name: 'WPS Spreadsheets',
      Workbooks: { Count: 1, Item: () => item, Open: vi.fn() },
      ActiveWorkbook: item,
      ActiveSheet: sheet,
      ActiveWindow: {},
      Selection: { Address: () => selected },
      Goto: vi.fn()
    }
    const { reports, stream } = await startReviewAddon(app, 'et')
    const command = {
      type: 'navigate',
      requestId: 'moved-zero',
      path: item.FullName,
      target: {
        kind: 'excel',
        sheet: 'Data',
        address: 'B2',
        value: '0',
        container: false,
        anchors: [
          { row: 0, column: -1, value: 'account-a' },
          { row: -1, column: 0, value: 'revenue' }
        ]
      }
    }
    stream.onmessage?.({ data: JSON.stringify(command) })
    expect(reports.at(-1)?.data).toMatchObject({
      status: 'located',
      selection: { kind: 'excel', sheet: 'Data', address: 'C4' }
    })
    values.set('4:3', 7)
    stream.onmessage?.({ data: JSON.stringify({ ...command, requestId: 'changed-value' }) })
    expect(reports.at(-1)?.data).toMatchObject({
      status: 'container',
      selection: { address: 'C4' }
    })
    values.set('9:2', 'account-a')
    values.set('8:3', 'revenue')
    values.set('4:3', 0)
    stream.onmessage?.({ data: JSON.stringify({ ...command, requestId: 'ambiguous' }) })
    expect(reports.at(-1)?.data).toMatchObject({ status: 'opened' })
    expect(reports.at(-1)?.data.reason).toContain('多处相同')
    expect(item.Close).not.toHaveBeenCalled()
    expect(item.Save).not.toHaveBeenCalled()
    expect(item.Saved).toBe(false)
  })

  it('resolves the current slide by native identity and confirms its selected shape', async () => {
    const shape = { Id: 42, TextFrame: { TextRange: { Text: 'edited' } }, Select: vi.fn() }
    const shapes = { Count: 1, Item: () => shape }
    const slide = { SlideID: 512, SlideIndex: 5, Shapes: shapes }
    const item = {
      FullName: '/tmp/review.pptx',
      Name: 'review.pptx',
      Slides: {
        Count: 1,
        Item: () => slide,
        FindBySlideID: vi.fn<() => typeof slide | null>(() => slide)
      },
      Activate: vi.fn(),
      Close: vi.fn(),
      Save: vi.fn()
    }
    const app = {
      Name: 'WPS Presentation',
      Presentations: { Count: 1, Item: () => item, Open: vi.fn() },
      ActivePresentation: item,
      ActiveWindow: {
        View: { GotoSlide: vi.fn(), Slide: slide },
        Selection: { ShapeRange: { Item: () => shape } }
      }
    }
    const { reports, stream } = await startReviewAddon(app, 'wpp')
    const command = {
      type: 'navigate',
      requestId: 'wpp-selection',
      path: item.FullName,
      target: { kind: 'ppt', slideId: 512, shapeId: 42, text: 'edited', container: false }
    }
    stream.onmessage?.({ data: JSON.stringify(command) })
    expect(reports.at(-1)).toMatchObject({
      kind: 'navigate-result',
      data: { status: 'located', selection: { kind: 'ppt', slideId: 512, shapeId: 42 } }
    })
    expect(item.Slides.FindBySlideID).toHaveBeenCalledWith(512)
    expect(app.ActiveWindow.View.GotoSlide).toHaveBeenCalledWith(5)
    item.Slides.FindBySlideID.mockReturnValueOnce(null)
    stream.onmessage?.({ data: JSON.stringify({ ...command, requestId: 'wpp-mac-id' }) })
    expect(reports.at(-1)?.data).toMatchObject({
      status: 'located',
      selection: { kind: 'ppt', slideId: 512, shapeId: 42 }
    })
    shape.TextFrame.TextRange.Text = 'edited plus later manual text'
    stream.onmessage?.({ data: JSON.stringify({ ...command, requestId: 'wpp-text-edited' }) })
    expect(reports.at(-1)?.data).toMatchObject({
      status: 'located',
      selection: { kind: 'ppt', slideId: 512, shapeId: 42 }
    })
    shapes.Count = 0
    stream.onmessage?.({ data: JSON.stringify({ ...command, requestId: 'wpp-deleted-shape' }) })
    expect(reports.at(-1)?.data).toMatchObject({
      status: 'container',
      selection: { kind: 'ppt', slideId: 512 }
    })
    expect(item.Close).not.toHaveBeenCalled()
    expect(item.Save).not.toHaveBeenCalled()
    expect(app.Presentations.Open).not.toHaveBeenCalled()
  })

  it('selects a verified range without closing, saving, or changing a dirty document', async () => {
    let text = 'context\rchanged paragraph\r'
    const selection = { Start: 0, End: 0 }
    const makeRange = (start: number, end: number) => ({
      Start: start,
      End: end,
      get Text() {
        return text.slice(this.Start, this.End)
      },
      get Duplicate(): ReturnType<typeof makeRange> {
        return makeRange(this.Start, this.End)
      },
      SetRange(from: number, to: number) {
        this.Start = from
        this.End = to
      },
      Select() {
        selection.Start = this.Start
        selection.End = this.End
      }
    })
    const paragraphs = [makeRange(0, 8), makeRange(8, text.length)]
    const close = vi.fn(),
      open = vi.fn(),
      save = vi.fn()
    const item = {
      FullName: '/tmp/dirty.docx',
      Name: 'dirty.docx',
      get Saved() {
        return false
      },
      set Saved(_value: boolean) {
        throw new Error('must not assign Saved')
      },
      Close: close,
      Save: save,
      Activate: vi.fn(),
      Content: {
        Paragraphs: { Count: 2, Item: (index: number) => ({ Range: paragraphs[index - 1] }) }
      }
    }
    const app = {
      Name: 'WPS Writer',
      Documents: { Count: 1, Item: () => item, Open: open },
      ActiveDocument: item,
      Selection: selection,
      ActiveWindow: { ScrollIntoView: vi.fn() }
    }
    const { reports, stream } = await startReviewAddon(app, 'wps')
    stream.onmessage?.({
      data: JSON.stringify({
        type: 'navigate',
        requestId: 'dirty-test',
        path: item.FullName,
        target: {
          kind: 'docx',
          part: 'word/document.xml',
          paragraph: 2,
          text: 'changed paragraph',
          previous: 'context',
          next: '',
          quote: 'changed',
          container: false
        }
      })
    })
    expect(reports.at(-1)).toMatchObject({
      kind: 'navigate-result',
      data: { status: 'located', selection: { start: 8, end: 15 } }
    })
    expect(item.Saved).toBe(false)
    expect(close).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    stream.onmessage?.({
      data: JSON.stringify({
        type: 'navigate',
        requestId: 'stale',
        path: item.FullName,
        target: {
          kind: 'docx',
          part: 'word/document.xml',
          paragraph: 2,
          text: 'old text',
          previous: 'context',
          next: '',
          container: false
        }
      })
    })
    expect(reports.at(-1)?.data.status).toBe('opened')
    expect(reports.at(-1)?.data.reason).toContain('无法确认')
    expect(selection).toEqual({ Start: 8, End: 15 })
    stream.onmessage?.({
      data: JSON.stringify({
        type: 'navigate',
        requestId: 'same-text-different-context',
        path: item.FullName,
        target: {
          kind: 'docx',
          part: 'word/document.xml',
          paragraph: 2,
          text: 'changed paragraph',
          previous: 'different section',
          next: '',
          quote: 'changed',
          container: false
        }
      })
    })
    expect(reports.at(-1)?.data.status).toBe('located')
    expect(selection).toEqual({ Start: 8, End: 15 })
    text = 'context\rchanged paragraph appended later\r'
    paragraphs[1] = makeRange(8, text.length)
    stream.onmessage?.({
      data: JSON.stringify({
        type: 'navigate',
        requestId: 'appended',
        path: item.FullName,
        target: {
          kind: 'docx',
          part: 'word/document.xml',
          paragraph: 2,
          text: 'changed paragraph',
          previous: 'context before editing',
          next: '',
          quote: 'changed',
          container: false
        }
      })
    })
    expect(reports.at(-1)?.data).toMatchObject({
      status: 'located',
      selection: { start: 8, end: 15 }
    })
    app.ActiveDocument = { ...item, FullName: '/tmp/other.docx' }
    stream.onmessage?.({
      data: JSON.stringify({
        type: 'navigate',
        requestId: 'wrong-active-document',
        path: item.FullName,
        target: null
      })
    })
    expect(reports.at(-1)?.data.status).toBe('opened')
    expect(reports.at(-1)?.data.reason).toContain('未激活目标文件')
    expect(selection).toEqual({ Start: 8, End: 15 })
  })
})

describe('WPS bounded native paragraph search', () => {
  it('finds a large move, rejects distant duplicates and caps repeated hits', async () => {
    const paragraphs = Array.from({ length: 10_000 }, () => 'unrelated\r')
    paragraphs[8000] = 'UNIQUE_MOVED_MARKER\r'
    let text = '',
      starts: number[] = [],
      paragraphReads = 0
    const rebuild = () => {
      text = ''
      starts = []
      for (const paragraph of paragraphs) {
        starts.push(text.length)
        text += paragraph
      }
    }
    rebuild()
    const selection = { Start: 0, End: 0 }
    const makeRange = (from: number, to: number) => ({
      Start: from,
      End: to,
      get Text() {
        return text.slice(this.Start, this.End)
      },
      get Duplicate(): ReturnType<typeof makeRange> {
        return makeRange(this.Start, this.End)
      },
      get Paragraphs() {
        const rangeStart = this.Start
        return {
          Count: paragraphs.length,
          Item: (index: number) => {
            paragraphReads++
            const actual =
              rangeStart === 0
                ? index - 1
                : starts.findIndex(
                    (start, i) =>
                      start <= rangeStart && (i + 1 === starts.length || starts[i + 1] > rangeStart)
                  )
            return { Range: makeRange(starts[actual], starts[actual] + paragraphs[actual].length) }
          }
        }
      },
      get Find() {
        const result = {
          Found: false,
          ClearFormatting() {},
          Execute: (query: string) => {
            const found = text.indexOf(query, this.Start)
            result.Found = found >= 0 && found + query.length <= this.End
            if (result.Found) {
              this.Start = found
              this.End = found + query.length
            }
          }
        }
        return result
      },
      SetRange(start: number, end: number) {
        this.Start = start
        this.End = end
      },
      Select() {
        selection.Start = this.Start
        selection.End = this.End
      }
    })
    const item = {
      FullName: '/tmp/large.docx',
      Name: 'large.docx',
      Saved: false,
      get Content() {
        return makeRange(0, text.length)
      },
      Activate: vi.fn(),
      Close: vi.fn(),
      Save: vi.fn()
    }
    const app = {
      Name: 'WPS Writer',
      Documents: { Count: 1, Item: () => item },
      ActiveDocument: item,
      Selection: selection,
      ActiveWindow: { ScrollIntoView: vi.fn() }
    }
    const { reports, stream } = await startReviewAddon(app, 'wps')
    const command = {
      type: 'navigate',
      requestId: 'large-moved',
      path: item.FullName,
      target: {
        kind: 'docx',
        part: 'word/document.xml',
        paragraph: 2,
        text: 'UNIQUE_MOVED_MARKER',
        previous: '',
        next: '',
        quote: 'UNIQUE_MOVED_MARKER',
        container: false
      }
    }
    stream.onmessage?.({ data: JSON.stringify(command) })
    expect(reports.at(-1)?.data).toMatchObject({
      status: 'located',
      selection: { start: starts[8000], end: starts[8000] + 19 }
    })
    expect(paragraphReads).toBeLessThan(220)
    paragraphs[9000] = 'UNIQUE_MOVED_MARKER\r'
    rebuild()
    stream.onmessage?.({ data: JSON.stringify({ ...command, requestId: 'distant-duplicate' }) })
    expect(reports.at(-1)?.data.status).toBe('opened')
    expect(reports.at(-1)?.data.reason).toContain('多处相同')
    stream.onmessage?.({
      data: JSON.stringify({
        ...command,
        requestId: 'hit-limit',
        target: { ...command.target, text: 'unrelated', quote: 'unrelated' }
      })
    })
    expect(reports.at(-1)?.data.status).toBe('opened')
    expect(reports.at(-1)?.data.reason).toContain('超时')
    expect(item.Close).not.toHaveBeenCalled()
    expect(item.Save).not.toHaveBeenCalled()
  })
})

describe('WPS integration feedback', () => {
  it('resets feedback after confirmed recovery and watches a subsequent failure again', async () => {
    let availability: WpsAddonAvailability = 'disabled'
    const notices: WpsIntegrationNotice[] = []
    const readAvailability = vi.fn(async () => availability)
    const service = new WpsSyncService({
      skipInstall: true,
      preferredPort: 0,
      readAvailability,
      onNotice: (notice) => notices.push(notice)
    })
    services.push(service)
    await service.start()
    const owner = readSseEvents(service.getPort()!, 'wps', 'recovery-owner')
    await waitFor(() => owner.events.length > 0)
    const open = async () => undefined
    vi.useFakeTimers()
    try {
      expect(await service.navigate('/tmp/recovery.docx', null, open)).toMatchObject({
        issue: { host: 'wps', state: 'not-enabled' }
      })
      await vi.advanceTimersByTimeAsync(1100)
      expect(notices).toEqual([]) // An old connected runtime does not override disable.
      availability = 'unconfirmed'
      await vi.advanceTimersByTimeAsync(1100)
      expect(notices).toEqual([]) // A failed config read does not prove re-enablement.
      availability = 'enabled'
      await vi.advanceTimersByTimeAsync(1100)
      expect(notices).toEqual([{ kind: 'ready', host: 'wps' }])
      const readsAfterRecovery = readAvailability.mock.calls.length
      await vi.advanceTimersByTimeAsync(3000)
      expect(readAvailability).toHaveBeenCalledTimes(readsAfterRecovery)
      availability = 'disabled'
      expect(await service.navigate('/tmp/recovery.docx', null, open)).toMatchObject({
        issue: { host: 'wps', state: 'not-enabled' }
      })
      availability = 'enabled'
      await vi.advanceTimersByTimeAsync(1100)
      expect(notices).toEqual([
        { kind: 'ready', host: 'wps' },
        { kind: 'ready', host: 'wps' }
      ])
    } finally {
      vi.useRealTimers()
      owner.close()
    }
  })

  it('requires the matching component connection before announcing recovery', async () => {
    let availability: WpsAddonAvailability = 'disabled'
    const notices: WpsIntegrationNotice[] = []
    const service = new WpsSyncService({
      skipInstall: true,
      preferredPort: 0,
      readAvailability: async () => availability,
      onNotice: (notice) => notices.push(notice)
    })
    services.push(service)
    await service.start()
    vi.useFakeTimers()
    try {
      await service.navigate('/tmp/recovery.docx', null, async () => undefined)
      availability = 'enabled'
      await vi.advanceTimersByTimeAsync(2000)
      expect(notices).toEqual([])
    } finally {
      vi.useRealTimers()
    }
    const excel = readSseEvents(service.getPort()!, 'et', 'unrelated-excel')
    await waitFor(() => excel.events.length > 0)
    expect(notices).toEqual([])
    const word = readSseEvents(service.getPort()!, 'wps', 'new-word-client')
    try {
      await waitFor(() => notices.some((notice) => notice.kind === 'ready'))
      expect(notices).toEqual([{ kind: 'ready', host: 'wps' }])
    } finally {
      word.close()
      excel.close()
    }
  })

  it('keeps recovery notifications isolated across Word and Excel', async () => {
    const availability: Record<WpsHost, WpsAddonAvailability> = {
      wps: 'disabled',
      et: 'disabled',
      wpp: 'disabled'
    }
    const notices: WpsIntegrationNotice[] = []
    const service = new WpsSyncService({
      skipInstall: true,
      preferredPort: 0,
      readAvailability: async (host) => availability[host],
      onNotice: (notice) => notices.push(notice)
    })
    services.push(service)
    await service.start()
    const word = readSseEvents(service.getPort()!, 'wps', 'word-isolation')
    const excel = readSseEvents(service.getPort()!, 'et', 'excel-isolation')
    await waitFor(() => word.events.length > 0 && excel.events.length > 0)
    vi.useFakeTimers()
    try {
      await service.navigate('/tmp/recovery.docx', null, async () => undefined)
      await service.navigate('/tmp/recovery.xlsx', null, async () => undefined)
      availability.wps = 'enabled'
      await vi.advanceTimersByTimeAsync(1100)
      expect(notices).toEqual([{ kind: 'ready', host: 'wps' }])
      await vi.advanceTimersByTimeAsync(2000)
      expect(notices).toHaveLength(1)
      availability.et = 'enabled'
      await vi.advanceTimersByTimeAsync(1100)
      expect(notices).toEqual([
        { kind: 'ready', host: 'wps' },
        { kind: 'ready', host: 'et' }
      ])
    } finally {
      vi.useRealTimers()
      word.close()
      excel.close()
    }
  })

  it('respects explicit disable even when an old client is still connected', async () => {
    const notices: object[] = []
    const service = new WpsSyncService({
      skipInstall: true,
      preferredPort: 0,
      readAvailability: async () => 'disabled',
      onNotice: (notice) => notices.push(notice)
    })
    services.push(service)
    await service.start()
    const port = service.getPort()!,
      owner = readSseEvents(port, 'wps', 'disabled-owner')
    await waitFor(() => owner.events.length > 0)
    await reportOpenItems(port, {
      component: 'wps',
      clientId: owner.clientId,
      fullNames: ['/tmp/disabled.docx']
    })
    const open = vi.fn(async () => undefined)
    expect(await service.navigate('/tmp/disabled.docx', null, open)).toMatchObject({
      status: 'opened',
      issue: { host: 'wps', state: 'not-enabled' }
    })
    expect(await service.prepareClose('/tmp/disabled.docx')).toBe(false)
    await service.notifyWritten('/tmp/disabled.docx')
    await service.notifyOpened('/tmp/disabled.docx')
    expect(owner.events.some((e) => ['navigate', 'close', 'open'].includes(e.type || ''))).toBe(
      false
    )
    expect(notices).toContainEqual({
      kind: 'integration',
      issue: { host: 'wps', state: 'not-enabled' }
    })
    expect(open).toHaveBeenCalledOnce()
    notices.length = 0
    await service.notifyWritten('/tmp/never-opened.docx')
    expect(notices).toHaveLength(0)
    owner.close()
  })

  it.each(['enabled', 'unconfirmed'] as const)(
    'does not mistake a different connected component for %s Word availability',
    async (availability) => {
      const notices: object[] = []
      const service = new WpsSyncService({
        skipInstall: true,
        preferredPort: 0,
        readAvailability: async () => availability,
        onNotice: (notice) => notices.push(notice)
      })
      services.push(service)
      await service.start()
      const port = service.getPort()!,
        excel = readSseEvents(port, 'et', 'only-excel')
      await waitFor(() => excel.events.length > 0)
      vi.useFakeTimers()
      try {
        const checking = service.notifyOpened('/tmp/unconnected.docx')
        await vi.advanceTimersByTimeAsync(8500)
        await checking
        expect(notices).toEqual([
          {
            kind: 'integration',
            issue: {
              host: 'wps',
              state: availability === 'enabled' ? 'not-connected' : 'unconfirmed'
            }
          }
        ])
      } finally {
        vi.useRealTimers()
        excel.close()
      }
    }
  )
})

describe('WPS refresh failure reporting', () => {
  it('reports a known-open document whose reload cannot be confirmed, without blaming authorization', async () => {
    const notices: object[] = []
    const service = new WpsSyncService({
      skipInstall: true,
      preferredPort: 0,
      readAvailability: async () => 'enabled',
      onNotice: (notice) => notices.push(notice)
    })
    services.push(service)
    await service.start()
    const port = service.getPort()!,
      owner = readSseEvents(port, 'wps', 'reload-timeout')
    await waitFor(() => owner.events.length > 0)
    await reportOpenItems(port, {
      component: 'wps',
      clientId: owner.clientId,
      fullNames: ['/tmp/timeout.docx']
    })
    vi.useFakeTimers()
    try {
      await service.notifyWritten('/tmp/timeout.docx')
      await vi.advanceTimersByTimeAsync(46_000)
      expect(notices).toEqual([
        { kind: 'refresh', reason: expect.stringContaining('未确认 WPS 已刷新') }
      ])
    } finally {
      vi.useRealTimers()
      owner.close()
    }
  })
})

describe('WPS review cold open', () => {
  it('opens once and keeps only the latest location while the document registers', async () => {
    const service = new WpsSyncService({
      readAvailability: async () => 'enabled',
      skipInstall: true,
      preferredPort: 0
    })
    services.push(service)
    await service.start()
    const port = service.getPort()!,
      owner = readSseEvents(port, 'wps', 'cold-review-owner')
    await waitFor(() => owner.events.length > 0)
    const open = vi.fn(async () => undefined)
    const target = {
      kind: 'docx' as const,
      part: 'word/document.xml',
      paragraph: 1,
      text: 'changed',
      previous: '',
      next: '',
      container: false
    }
    const first = service.navigate('/tmp/cold-review.docx', target, open)
    const second = service.navigate('/tmp/cold-review.docx', { ...target, paragraph: 2 }, open)
    await reportOpenItems(port, {
      component: 'wps',
      clientId: owner.clientId,
      fullNames: ['/tmp/cold-review.docx']
    })
    await waitFor(() => owner.events.some((event) => event.type === 'navigate'))
    expect(open).toHaveBeenCalledTimes(1)
    expect((await first).status).toBe('opened')
    const commands = owner.events.filter((event) => event.type === 'navigate')
    expect(commands).toHaveLength(1)
    await postReport(port, {
      kind: 'navigate-result',
      component: 'wps',
      clientId: owner.clientId,
      data: {
        requestId: commands[0].requestId,
        fullName: '/tmp/cold-review.docx',
        status: 'container',
        reason: 'paragraph'
      }
    })
    expect(await second).toEqual({ status: 'container', reason: 'paragraph' })
    owner.close()
  })
})
