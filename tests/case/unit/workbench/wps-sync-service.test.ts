import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false
  }
}))

import { WPS_ADDON_FILES, WPS_ADDON_NAME } from '../../../../src/main/services/wps/constants'
import {
  notifyOfficeFileWritten,
  setOfficeFileWriteListener
} from '../../../../src/main/services/wps/officeFileWriteNotify'
import { mergePublishXml, toAddonFileUrl } from '../../../../src/main/services/wps/publishXml'
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
    const addonDir = '/tmp/jsaddons/ncurator-sync'
    const merged = mergePublishXml(
      `<jsplugins>
  <jspluginonline name="other" type="wps" url="http://example.local/addon" enable="true" install=""/>
  <jspluginonline name="ncuratorsyncpoc" type="wps" url="http://127.0.0.1:58123/addon" enable="true" install=""/>
  <jspluginonline name="ncurator-sync" type="et" url="file:///old/" enable="true" install=""/>
</jsplugins>
`,
      toAddonFileUrl(addonDir)
    )

    expect(merged).toContain('name="other"')
    expect(merged).not.toContain('ncuratorsyncpoc')
    expect(merged.match(/name="ncurator-sync"/g)?.length).toBe(3)
    expect(merged).toContain('type="wps"')
    expect(merged).toContain('type="et"')
    expect(merged).toContain('type="wpp"')
    expect(merged).toContain(toAddonFileUrl(addonDir))
    expect(merged).toContain('enable="true"')
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

  it('copies the offline addon and writes publish.xml plus port.json', async () => {
    const jsAddonsDir = await createTempDir('ncurator-wps-jsaddons-')
    const installer = new WpsAddonInstaller({
      addonSourceDir: path.join(process.cwd(), 'resources', 'wps-addon'),
      jsAddonsDir
    })

    const result = await installer.install()
    expect(result.installed).toBe(true)
    const addonDir = path.join(jsAddonsDir, WPS_ADDON_NAME)
    for (const fileName of WPS_ADDON_FILES) {
      await expect(fs.stat(path.join(addonDir, fileName))).resolves.toBeTruthy()
    }
    const publish = await fs.readFile(path.join(jsAddonsDir, 'publish.xml'), 'utf8')
    expect(publish).toContain(`url="${toAddonFileUrl(addonDir)}"`)
    expect(publish).toContain('name="ncurator-sync"')

    await installer.writePort(58129)
    expect(JSON.parse(await fs.readFile(path.join(addonDir, 'port.json'), 'utf8'))).toEqual({
      port: 58129
    })
  })
})

describe('office file write notify', () => {
  it('notifies resolved office paths and ignores other files', () => {
    const received: string[] = []
    setOfficeFileWriteListener((filePath) => received.push(filePath))
    notifyOfficeFileWritten('/tmp/notes.md')
    notifyOfficeFileWritten('/tmp/report.DOCX')
    expect(received).toEqual([path.resolve('/tmp/report.DOCX')])
  })
})

describe('WpsOpenDocumentRegistry', () => {
  it('matches open documents across path separators and case', () => {
    const registry = new WpsOpenDocumentRegistry()
    registry.setDocuments('wps', [{ name: 'a.docx', fullName: '/Users/Me/Docs/A.docx' }])
    expect(registry.isOpen('/Users/Me/Docs/A.docx')).toBe(true)
    expect(registry.isOpen('/users/me/docs/a.docx')).toBe(true)
    expect(registry.isOpen('/Users/Me/Docs/other.docx')).toBe(false)
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

  it('starts the loopback server without installing when skipInstall is set', async () => {
    const install = vi.fn()
    const writePort = vi.fn()
    const service = new WpsSyncService({
      skipInstall: true,
      preferredPort: 0,
      installer: { install, writePort }
    })
    services.push(service)
    await service.start()
    expect(service.getPort()).toBeTruthy()
    expect(install).not.toHaveBeenCalled()
    expect(writePort).not.toHaveBeenCalled()
  })
})
