import type { ReviewLocation, ReviewNavigationResult } from '../../../shared/fileReview'
import fs from 'node:fs/promises'
import path from 'node:path'

export type OfficeWriteHost = 'wps' | 'et' | 'wpp'

const OFFICE_WRITE_HOSTS: Record<string, OfficeWriteHost> = {
  '.docx': 'wps',
  '.xlsx': 'et',
  '.pptx': 'wpp'
}

const UNLOCK_WAIT_MS = 4_000
const UNLOCK_POLL_MS = 50

export const officeWriteHostForPath = (filePath: string): OfficeWriteHost | undefined =>
  OFFICE_WRITE_HOSTS[path.extname(filePath).toLowerCase()]

export const isOfficeWritePath = (filePath: string): boolean =>
  officeWriteHostForPath(filePath) !== undefined

export const normalizeOfficePath = (filePath: string): string =>
  path.resolve(filePath).replace(/\\/g, '/').toLowerCase()

export type OfficeFileWriteListener = {
  navigate?: (
    filePath: string,
    target: ReviewLocation | null,
    open: () => Promise<void>
  ) => Promise<ReviewNavigationResult>
  prepareClose?: (filePath: string) => Promise<boolean>
  notifyWritten: (filePath: string) => void | Promise<void>
  notifyOpened?: (filePath: string) => Promise<void>
}

let listener: OfficeFileWriteListener | undefined

export const setOfficeFileWriteListener = (next?: OfficeFileWriteListener): void => {
  listener = next
}

const resolveOfficeWritePath = (filePath: string): string | undefined => {
  const value = String(filePath || '').trim()
  if (!value || !isOfficeWritePath(value)) return undefined
  return path.resolve(value)
}

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export const waitForOfficePathUnlocked = async (
  filePath: string,
  timeoutMs = UNLOCK_WAIT_MS
): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const handle = await fs.open(filePath, 'r+')
      await handle.close()
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return
      await sleep(UNLOCK_POLL_MS)
    }
  }
}

export const notifyOfficeFileWritten = (filePath: string): void => {
  const resolved = resolveOfficeWritePath(filePath)
  if (!resolved) return
  try {
    void Promise.resolve(listener?.notifyWritten(resolved)).catch(() => undefined)
  } catch {
    // 刷新失败不得影响写盘。
  }
}

export const notifyWpsFileOpened = (filePath: string): void => {
  const resolved = resolveOfficeWritePath(filePath)
  if (resolved) void listener?.notifyOpened?.(resolved).catch(() => undefined)
}

export const withOfficeFileWrite = async <T>(
  filePath: string,
  write: () => Promise<T>
): Promise<T> => {
  const resolved = resolveOfficeWritePath(filePath)
  if (!resolved) return await write()
  let released = false
  try {
    released = (await listener?.prepareClose?.(resolved)) === true
  } catch {
    released = false
  }
  if (released) await waitForOfficePathUnlocked(resolved)
  try {
    return await write()
  } catch (error) {
    if (released) notifyOfficeFileWritten(resolved)
    throw error
  }
}

export const navigateOfficeReview = async (
  filePath: string,
  target: ReviewLocation | null,
  open: () => Promise<void>
): Promise<ReviewNavigationResult> => {
  if (listener?.navigate) return listener.navigate(filePath, target, open)
  await open()
  return { status: 'opened', reason: '已请求打开文件，WPS 加载项尚未连接，未完成定位' }
}
