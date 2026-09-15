import { WPS_PREFERRED_SYNC_PORT } from '../../../src/main/services/wps/constants'
import { normalizeOfficePath } from '../../../src/main/services/wps/officeFileWriteNotify'

export type WpsSyncReloadEvent = {
  type?: string
  path?: string
}

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

const parseSseBuffer = (buffer: string, events: WpsSyncReloadEvent[]): string => {
  const frames = buffer.split('\n\n')
  const remainder = frames.pop() || ''
  for (const frame of frames) {
    const line = frame.split('\n').find((item) => item.startsWith('data: '))
    if (!line) continue
    events.push(JSON.parse(line.slice(6)) as WpsSyncReloadEvent)
  }
  return remainder
}

export const countWpsReloadsForPath = (events: WpsSyncReloadEvent[], filePath: string): number => {
  const key = normalizeOfficePath(filePath)
  return events.filter(
    (event) => event.type === 'reload' && event.path && normalizeOfficePath(event.path) === key
  ).length
}

export const connectWpsSyncEvents = async (options?: {
  port?: number
  timeoutMs?: number
}): Promise<{ events: WpsSyncReloadEvent[]; close: () => void }> => {
  const port = options?.port ?? WPS_PREFERRED_SYNC_PORT
  const timeoutMs = options?.timeoutMs ?? 20_000
  const deadline = Date.now() + timeoutMs
  let lastError: unknown

  while (Date.now() < deadline) {
    const controller = new AbortController()
    const events: WpsSyncReloadEvent[] = []
    try {
      const response = await fetch(`http://127.0.0.1:${port}/events?component=wps`, {
        signal: controller.signal
      })
      if (!response.body) throw new Error('wps sync SSE body is empty')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      void (async () => {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer = parseSseBuffer(buffer + decoder.decode(value, { stream: true }), events)
        }
      })().catch(() => undefined)

      const pingDeadline = Date.now() + 3_000
      while (Date.now() < pingDeadline) {
        if (events.some((event) => event.type === 'ping')) {
          return {
            events,
            close: () => controller.abort()
          }
        }
        await sleep(20)
      }
      controller.abort()
      lastError = new Error('wps sync SSE connected without ping')
    } catch (error) {
      lastError = error
      controller.abort()
      await sleep(150)
    }
  }

  throw new Error(
    `WPS sync SSE not reachable on 127.0.0.1:${port}${
      lastError instanceof Error ? `: ${lastError.message}` : ''
    }`
  )
}
