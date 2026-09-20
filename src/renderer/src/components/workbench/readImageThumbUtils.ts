import type { IpcJsonObject, IpcJsonValue } from '../../../../shared/types'

const isRemoteImagePath = (value: string): boolean => /^https?:\/\//i.test(value)

export const guessImageMimeType = (pathValue: string): string => {
  const base = pathValue.split(/[\\/]/u).pop() || pathValue
  const extension = base.split('.').pop()?.toLowerCase() || ''
  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'gif') return 'image/gif'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'bmp') return 'image/bmp'
  if (extension === 'svg') return 'image/svg+xml'
  return 'image/png'
}

export const isReadImageRemotePath = isRemoteImagePath

export const readImagePathsFromInput = (input?: IpcJsonObject): string[] => {
  if (!input) return []
  const raw = input.paths
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
