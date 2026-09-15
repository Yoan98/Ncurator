import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false
  }
}))

import { authAddinNeedsRewrite, mergeAuthAddin } from '../../../../src/main/services/wps/authAddin'
import { WPS_ADDON_DIR_NAME, WPS_ADDON_NAME, WPS_ADDON_PORT_FILE } from '../../../../src/main/services/wps/constants'
import {
  notifyOfficeFileWritten,
  setOfficeFileWriteListener
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

const waitFor = async (predicate: () => boolean, timeoutMs = 2_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for WPS sync event')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

const readSseEvents = (
  port: number
): { events: Array<{ type?: string; path?: string }>; close: () => void } => {
  const events: Array<{ type?: string; path?: string }> = []
  const controller = new AbortController()
  void fetch(`http://127.0.0.1:${port}/events?component=wps`, {
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
    events,
    close: () => controller.abort()
  }
}

afterEach(async () => {
  setOfficeFileWriteListener(undefined)
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
    await fs.writeFile(path.join(jsAddonsDir, WPS_ADDON_DIR_NAME, 'ribbon.xml'), '<offline/>', 'utf8')
    await fs.writeFile(path.join(jsAddonsDir, 'jsaddinblockhost.ini'), '[Mainhost]\nblocked=1\n', 'utf8')
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
    expect(publish).toContain('url="http://127.0.0.1:58123/addon/"')
    expect(publish).toContain('<jspluginonline ')
    expect(publish).toContain('name="ncurator-sync"')
    expect(publish).toContain('enable="enable_dev"')
    expect(JSON.parse(await fs.readFile(path.join(jsAddonsDir, WPS_ADDON_PORT_FILE), 'utf8'))).toEqual({
      port: 58123
    })
    expect(JSON.parse(await fs.readFile(path.join(jsAddonsDir, 'authaddin.json'), 'utf8'))).toMatchObject({
      wps: {
        abc: {
          enable: true,
          mode: 2,
          path: 'http://127.0.0.1:58123/addon/'
        },
        namelist: 'abc'
      }
    })

    const authAfterInstall = await fs.readFile(path.join(jsAddonsDir, 'authaddin.json'), 'utf8')
    await installer.writePort(58129)
    expect(JSON.parse(await fs.readFile(path.join(jsAddonsDir, WPS_ADDON_PORT_FILE), 'utf8'))).toEqual({
      port: 58129
    })
    const publishAfterFallback = await fs.readFile(path.join(jsAddonsDir, 'publish.xml'), 'utf8')
    expect(publishAfterFallback).toContain('url="http://127.0.0.1:58123/addon/"')
    expect(publishAfterFallback).not.toContain('58129')
    expect(publishXmlHasAddonUrl(publishAfterFallback, toAddonLoopbackUrl(58123))).toBe(true)
    expect(await fs.readFile(path.join(jsAddonsDir, 'authaddin.json'), 'utf8')).toBe(authAfterInstall)
  })

  it('writes the loopback port file without installing', async () => {
    const jsAddonsDir = await createTempDir('ncurator-wps-jsaddons-port-only-')
    const leftoverDir = path.join(jsAddonsDir, WPS_ADDON_NAME)
    await fs.mkdir(leftoverDir, { recursive: true })
    const installer = new WpsAddonInstaller({
      addonSourceDir: path.join(process.cwd(), 'resources', 'wps-addon'),
      jsAddonsDir
    })
    await installer.writePort(58123)
    expect(JSON.parse(await fs.readFile(path.join(jsAddonsDir, WPS_ADDON_PORT_FILE), 'utf8'))).toEqual({
      port: 58123
    })
    await expect(fs.stat(leftoverDir)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('office file write notify', () => {
  it('notifies resolved office paths and ignores other files', () => {
    const received: string[] = []
    setOfficeFileWriteListener((filePath) => received.push(filePath))
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
})

describe('WpsOpenDocumentRegistry', () => {
  it('matches open documents across path separators and case', () => {
    const registry = new WpsOpenDocumentRegistry()
    registry.setDocuments('wps', [{ name: 'a.docx', fullName: '/Users/Me/Docs/A.docx' }])
    expect(registry.isOpen('/Users/Me/Docs/A.docx')).toBe(true)
    expect(registry.isOpen('/users/me/docs/a.docx')).toBe(true)
    expect(registry.isOpen('/Users/Me/Docs/other.docx')).toBe(false)
    expect(registry.listOpenDocuments()).toEqual([
      { component: 'wps', fullName: '/Users/Me/Docs/A.docx' }
    ])
  })
})

describe('WpsSyncService', () => {
  it('skips listening when WPS is not installed', async () => {
    const service = new WpsSyncService({
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

  it('broadcasts reload to connected add-ins after an office file write', async () => {
    const addonDir = await createTempDir('ncurator-wps-addon-dir-')
    let writtenPort: number | undefined
    const service = new WpsSyncService({
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

    await fetch(`http://127.0.0.1:${port}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        component: 'wps',
        data: { items: [{ name: 'a.docx', fullName: '/tmp/opened.docx' }] }
      })
    })
    expect(service.getOpenRegistry().isOpen('/tmp/opened.docx')).toBe(true)

    service.notifyWritten('/tmp/opened.docx')
    await waitFor(() => stream.events.some((event) => event.type === 'reload'))
    expect(
      stream.events.some(
        (event) => event.type === 'reload' && event.path === path.resolve('/tmp/opened.docx')
      )
    ).toBe(true)
    stream.close()
  })

  it('records dispatches on GET /status even without connected add-ins', async () => {
    const addonDir = await createTempDir('ncurator-wps-addon-dir-')
    const service = new WpsSyncService({
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
    await fetch(`http://127.0.0.1:${port}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'reload-result',
        component: 'wps',
        at: 1_700_000_000_000,
        data: {
          ok: false,
          reason: 'not open here',
          targetPath: '/tmp/opened.docx'
        }
      })
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
