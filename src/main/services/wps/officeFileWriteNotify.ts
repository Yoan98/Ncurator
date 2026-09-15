import path from 'node:path'

const OFFICE_WRITE_EXTENSIONS = new Set(['.docx', '.pptx', '.xlsx'])

export const isOfficeWritePath = (filePath: string): boolean =>
  OFFICE_WRITE_EXTENSIONS.has(path.extname(filePath).toLowerCase())

export const normalizeOfficePath = (filePath: string): string =>
  path.resolve(filePath).replace(/\\/g, '/').toLowerCase()

type OfficeFileWriteListener = (filePath: string) => void

let listener: OfficeFileWriteListener | undefined

export const setOfficeFileWriteListener = (next?: OfficeFileWriteListener): void => {
  listener = next
}

export const notifyOfficeFileWritten = (filePath: string): void => {
  const value = String(filePath || '').trim()
  if (!value || !isOfficeWritePath(value)) return
  try {
    listener?.(path.resolve(value))
  } catch {
    // 刷新失败不得影响写盘。
  }
}
