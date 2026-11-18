/**
 * Blob URL cache for local image files.
 *
 * `<img src="…">` cannot point at a local path: the renderer CSP allows
 * `img-src 'self' data: blob: http: https:` but not `file:`, so bytes are read
 * through the preload bridge and exposed as blob URLs.
 *
 * The cache is process-wide and insertion-ordered (oldest evicted first) because
 * assistant markdown re-renders on every streamed token: the same image must not
 * trigger a new IPC read per render.
 */

import { imageMimeFromPath } from '../../../shared/imageFiles'

const MAX_CACHED_URLS = 48

const urlCache = new Map<string, string>()
const pendingLoads = new Map<string, Promise<string | null>>()

const evictOldest = (): void => {
  while (urlCache.size > MAX_CACHED_URLS) {
    const oldest = urlCache.entries().next().value as [string, string] | undefined
    if (!oldest) return
    urlCache.delete(oldest[0])
    URL.revokeObjectURL(oldest[1])
  }
}

/** Resolves to a blob URL, or null when the file is missing or unreadable. */
export const loadLocalImageUrl = (filePath: string): Promise<string | null> => {
  const cached = urlCache.get(filePath)
  if (cached) return Promise.resolve(cached)

  const pending = pendingLoads.get(filePath)
  if (pending) return pending

  const load = (async (): Promise<string | null> => {
    try {
      if (!(await window.api.fileExists(filePath))) return null
      const bytes = await window.api.readFile(filePath)
      const buffer = new ArrayBuffer(bytes.byteLength)
      new Uint8Array(buffer).set(bytes)
      const url = URL.createObjectURL(new Blob([buffer], { type: imageMimeFromPath(filePath) }))
      urlCache.set(filePath, url)
      evictOldest()
      return url
    } catch {
      return null
    } finally {
      pendingLoads.delete(filePath)
    }
  })()

  pendingLoads.set(filePath, load)
  return load
}
