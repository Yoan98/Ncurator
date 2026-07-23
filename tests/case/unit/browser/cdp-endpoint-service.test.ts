import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CdpEndpointService,
  DEVTOOLS_ACTIVE_PORT_FILENAME,
  parseDevToolsActivePort
} from '../../../../src/main/services/browser/CdpEndpointService'

const tempDirectories: string[] = []

const createTempDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-cdp-test-'))
  tempDirectories.push(directory)
  return directory
}

const createVersionResponse = (port: number, browserPath: string): Response =>
  new Response(
    JSON.stringify({
      webSocketDebuggerUrl: `ws://127.0.0.1:${String(port)}${browserPath}`
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('CdpEndpointService', () => {
  it('parses Chromium DevToolsActivePort content', () => {
    expect(parseDevToolsActivePort('43125\n/devtools/browser/browser-id\n')).toEqual({
      port: 43125,
      browserPath: '/devtools/browser/browser-id'
    })
  })

  it.each([
    '',
    '0\n/devtools/browser/id',
    '70000\n/devtools/browser/id',
    '9333\n/devtools/page/id'
  ])('rejects malformed DevToolsActivePort content: %s', (content) => {
    expect(() => parseDevToolsActivePort(content)).toThrow()
  })

  it('waits for the endpoint, validates it and caches the result', async () => {
    const directory = await createTempDirectory()
    const browserPath = '/devtools/browser/dynamic-id'
    const fetchImpl = vi.fn(async () =>
      createVersionResponse(43125, browserPath)
    ) as unknown as typeof fetch
    const service = new CdpEndpointService({
      userDataPath: directory,
      timeoutMs: 500,
      pollIntervalMs: 5,
      fetchImpl
    })

    setTimeout(() => {
      void writeFile(
        path.join(directory, DEVTOOLS_ACTIVE_PORT_FILENAME),
        `43125\n${browserPath}\n`,
        'utf8'
      )
    }, 20)

    const first = await service.getEndpoint()
    const second = await service.getEndpoint()

    expect(first).toEqual({
      port: 43125,
      httpOrigin: 'http://127.0.0.1:43125',
      browserWebSocketUrl: 'ws://127.0.0.1:43125/devtools/browser/dynamic-id'
    })
    expect(second).toBe(first)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('rejects a CDP endpoint that reports a non-loopback WebSocket URL', async () => {
    const directory = await createTempDirectory()
    await writeFile(
      path.join(directory, DEVTOOLS_ACTIVE_PORT_FILENAME),
      '43125\n/devtools/browser/dynamic-id\n',
      'utf8'
    )
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            webSocketDebuggerUrl: 'ws://192.168.1.20:43125/devtools/browser/dynamic-id'
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    ) as unknown as typeof fetch
    const service = new CdpEndpointService({
      userDataPath: directory,
      timeoutMs: 20,
      pollIntervalMs: 1,
      fetchImpl
    })

    await expect(service.getEndpoint()).rejects.toThrow('embedded_browser_cdp_unavailable')
  })
})
