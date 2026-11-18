import type { IpcJsonObject, IpcJsonValue } from '../types'

const isRemoteImagePath = (value: string): boolean => /^https?:\/\//i.test(value)

export const isReadImageRemotePath = isRemoteImagePath

export const readImagePathsFromInput = (input?: IpcJsonObject): string[] => {
  if (!input) return []
  const raw = (input as Record<string, IpcJsonValue>).paths
  if (!Array.isArray(raw)) return []
  return raw.flatMap((value: IpcJsonValue) => {
    if (typeof value !== 'string') return []
    const trimmed = value.trim()
    return trimmed ? [trimmed] : []
  })
}

export const readImageDisplayName = (pathValue: string): string => {
  if (isRemoteImagePath(pathValue)) {
    try {
      const url = new URL(pathValue)
      const last = url.pathname.split('/').filter(Boolean).pop()
      if (last) return decodeURIComponent(last)
    } catch {
      // fall through
    }
  }
  const normalized = pathValue.replace(/\\/gu, '/')
  const last = normalized.split('/').filter(Boolean).pop()
  return last || pathValue
}
