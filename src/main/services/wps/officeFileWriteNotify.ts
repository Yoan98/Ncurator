import path from 'node:path'

export type OfficeWriteHost = 'wps' | 'et' | 'wpp'

const OFFICE_WRITE_HOSTS: Record<string, OfficeWriteHost> = {
  '.docx': 'wps',
  '.xlsx': 'et',
  '.pptx': 'wpp'
}

export const officeWriteHostForPath = (filePath: string): OfficeWriteHost | undefined =>
  OFFICE_WRITE_HOSTS[path.extname(filePath).toLowerCase()]

export const isOfficeWritePath = (filePath: string): boolean =>
  officeWriteHostForPath(filePath) !== undefined

export const normalizeOfficePath = (filePath: string): string =>
  path.resolve(filePath).replace(/\\/g, '/').toLowerCase()

export type OfficeFileWriteListener = {
  prepareClose?: (filePath: string) => Promise<boolean>
  notifyWritten: (filePath: string) => void
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

export const notifyOfficeFileWritten = (filePath: string): void => {
  const resolved = resolveOfficeWritePath(filePath)
  if (!resolved) return
  try {
    listener?.notifyWritten(resolved)
  } catch {
    // 刷新失败不得影响写盘。
  }
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
  if (released) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100)
    })
  }
  try {
    return await write()
  } catch (error) {
    if (released) notifyOfficeFileWritten(resolved)
    throw error
  }
}
