import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CdpEndpointService,
  type CdpDebuggableContents
} from '../../../../src/main/services/browser/CdpEndpointService'

const APP_BOOT_SOURCE = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../src/main/index.ts'),
  'utf8'
)

class FakeDebugger extends EventEmitter {
  public attached = false
  public commands: Array<{ method: string; params: unknown; sessionId?: string }> = []

  public attach(): void {
    this.attached = true
  }

  public detach(): void {
    this.attached = false
  }

  public isAttached(): boolean {
    return this.attached
  }

  public async sendCommand(method: string, params?: unknown, sessionId?: string): Promise<unknown> {
    this.commands.push({ method, params, sessionId })
    if (method === 'Runtime.evaluate') {
      return { result: { type: 'string', value: 'ok' } }
    }
    return {}
  }
}

class FakeContents extends EventEmitter {
  public readonly debugger = new FakeDebugger()

  public constructor(
    public readonly id: number,
    public url = 'https://example.com/',
    public title = 'Example'
  ) {
    super()
  }

  public isDestroyed(): boolean {
    return false
  }

  public getURL(): string {
    return this.url
  }

  public getTitle(): string {
    return this.title
  }
}

const services: CdpEndpointService[] = []

const createService = (): CdpEndpointService => {
  const service = new CdpEndpointService()
  services.push(service)
  return service
}

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()))
})

const sendCdp = async (
  socket: WebSocket,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const id = payload.id
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`CDP timeout for ${String(payload.method)}`)),
      3_000
    )
    const onMessage = (event: MessageEvent): void => {
      const message = JSON.parse(String(event.data)) as Record<string, unknown>
      if (message.id !== id) return
      clearTimeout(timer)
      socket.removeEventListener('message', onMessage)
      if (message.error) {
        reject(new Error(String((message.error as { message?: string }).message || 'cdp error')))
        return
      }
      resolve((message.result as Record<string, unknown>) || {})
    }
    socket.addEventListener('message', onMessage)
    socket.send(JSON.stringify(payload))
  })
}

describe('CdpEndpointService bridge', () => {
  it('registers a WebContents into /json/list and removes it on unregister', async () => {
    const service = createService()
    const contents = new FakeContents(
      11,
      'https://example.com/page',
      'Demo'
    ) as unknown as CdpDebuggableContents
    const targetId = service.registerTarget(contents)
    const endpoint = await service.getEndpoint()

    expect(endpoint.browserWebSocketUrl.startsWith('ws://127.0.0.1:')).toBe(true)
    expect(endpoint.httpOrigin.startsWith('http://127.0.0.1:')).toBe(true)

    const listed = await (await fetch(`${endpoint.httpOrigin}/json/list`)).json()
    expect(listed).toEqual([
      expect.objectContaining({
        id: targetId,
        title: 'Demo',
        type: 'page',
        url: 'https://example.com/page'
      })
    ])

    const version = (await (await fetch(`${endpoint.httpOrigin}/json/version`)).json()) as {
      webSocketDebuggerUrl: string
    }
    expect(version.webSocketDebuggerUrl).toBe(endpoint.browserWebSocketUrl)

    service.unregisterTarget(targetId)
    const empty = await (await fetch(`${endpoint.httpOrigin}/json/list`)).json()
    expect(empty).toEqual([])
  })

  it('forwards page CDP commands through the attached debugger session', async () => {
    const service = createService()
    const contents = new FakeContents(
      12,
      'https://example.com/act',
      'Act'
    ) as unknown as CdpDebuggableContents
    const targetId = service.registerTarget(contents)
    const endpoint = await service.getEndpoint()
    const socket = new WebSocket(endpoint.browserWebSocketUrl)
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve())
      socket.addEventListener('error', () => reject(new Error('websocket error')))
    })

    await sendCdp(socket, {
      id: 1,
      method: 'Target.setAutoAttach',
      params: { autoAttach: true, flatten: true, waitForDebuggerOnStart: true }
    })
    const targets = await sendCdp(socket, { id: 2, method: 'Target.getTargets', params: {} })
    const infos = targets.targetInfos as Array<{ targetId: string; attached: boolean }>
    expect(infos).toEqual([expect.objectContaining({ targetId, attached: true })])

    const attached = await sendCdp(socket, {
      id: 3,
      method: 'Target.attachToTarget',
      params: { targetId, flatten: true }
    })
    const sessionId = String(attached.sessionId || '')
    expect(sessionId.length).toBeGreaterThan(0)

    const evaluated = await sendCdp(socket, {
      id: 4,
      method: 'Runtime.evaluate',
      sessionId,
      params: { expression: '1+1' }
    })
    expect(evaluated).toEqual({ result: { type: 'string', value: 'ok' } })
    expect((contents as unknown as FakeContents).debugger.attached).toBe(true)
    expect(
      (contents as unknown as FakeContents).debugger.commands.some(
        (item) => item.method === 'Runtime.evaluate'
      )
    ).toBe(true)

    socket.close()
    service.unregisterTarget(targetId)
    expect((contents as unknown as FakeContents).debugger.attached).toBe(false)
  })
})

describe('scoped CDP clients', () => {
  it('isolates discovery, attach, fallback and target events across simultaneous clients', async () => {
    const service = createService()
    const a = service.registerTarget(new FakeContents(101) as unknown as CdpDebuggableContents)
    const b = service.registerTarget(new FakeContents(102) as unknown as CdpDebuggableContents)
    const socketA = new WebSocket((await service.getScopedEndpoint(a)).browserWebSocketUrl)
    const socketB = new WebSocket((await service.getScopedEndpoint(b)).browserWebSocketUrl)
    await Promise.all(
      [socketA, socketB].map(
        (socket) => new Promise<void>((resolve) => socket.addEventListener('open', () => resolve()))
      )
    )
    try {
      const targetsA = await sendCdp(socketA, { id: 1, method: 'Target.getTargets' })
      const targetsB = await sendCdp(socketB, { id: 1, method: 'Target.getTargets' })
      expect(targetsA.targetInfos).toEqual([expect.objectContaining({ targetId: a })])
      expect(targetsB.targetInfos).toEqual([expect.objectContaining({ targetId: b })])
      await expect(
        sendCdp(socketA, { id: 2, method: 'Target.attachToTarget', params: { targetId: b } })
      ).rejects.toThrow('No target')
      expect(
        await sendCdp(socketB, {
          id: 3,
          method: 'Target.createTarget',
          params: { url: 'about:blank' }
        })
      ).toEqual({ targetId: b })
      service.unregisterTarget(a)
      expect((await sendCdp(socketB, { id: 4, method: 'Target.getTargets' })).targetInfos).toEqual([
        expect.objectContaining({ targetId: b })
      ])
    } finally {
      socketA.close()
      socketB.close()
    }
  })
})

describe('app boot CDP policy', () => {
  it('does not append a process-level remote-debugging-port', () => {
    expect(APP_BOOT_SOURCE).toContain('new CdpEndpointService()')
    expect(APP_BOOT_SOURCE).not.toMatch(/appendSwitch\(\s*['"]remote-debugging-port['"]/u)
    expect(APP_BOOT_SOURCE).not.toMatch(/appendSwitch\(\s*['"]remote-debugging-address['"]/u)
  })
})
