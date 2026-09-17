/**
 * Resolve Markdown image destinations to local filesystem paths for in-app display.
 * Does not rewrite Markdown source; callers hydrate DOM `img.src` to blob/data URLs.
 */

import { classifyMarkdownHref, decodeMarkdownHref, unwrapMarkdownLinkDestination } from './markdownLink'

const WINDOWS_ABS_PATH_RE = /^[a-zA-Z]:[\\/]/

export const dirnamePath = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  if (index <= 0) return normalized
  return normalized.slice(0, index)
}

export const joinFsPath = (baseDir: string, relative: string): string => {
  const base = baseDir.replace(/\\/g, '/').replace(/\/+$/, '')
  const rel = relative.replace(/\\/g, '/')
  if (WINDOWS_ABS_PATH_RE.test(rel) || rel.startsWith('/')) return decodeMarkdownHref(rel)

  const segments = [...base.split('/'), ...rel.split('/')]
  const stack: string[] = []
  for (const segment of segments) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      const top = stack[stack.length - 1]
      if (top && !/^[a-zA-Z]:$/i.test(top)) stack.pop()
      continue
    }
    stack.push(segment)
  }

  if (base.startsWith('/')) return `/${stack.join('/')}`
  return stack.join('/')
}

const guessImageMime = (filePath: string): string => {
  const extension = filePath.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'bmp':
      return 'image/bmp'
    case 'svg':
      return 'image/svg+xml'
    default:
      return 'application/octet-stream'
  }
}

/**
 * Returns an absolute local path when `rawSrc` should be loaded from disk.
 * Returns null for http(s)/data/blob and other non-local destinations.
 */
export const resolveMarkdownImageLocalPath = (
  markdownFilePath: string,
  rawSrc: string
): string | null => {
  const src = decodeMarkdownHref(unwrapMarkdownLinkDestination(rawSrc)).trim()
  if (!src) return null

  const lower = src.toLowerCase()
  if (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('data:') ||
    lower.startsWith('blob:')
  ) {
    return null
  }

  const classified = classifyMarkdownHref(src)
  if (classified.type === 'file') return classified.path
  if (classified.type === 'unknown' && !src.includes('://')) {
    return joinFsPath(dirnamePath(markdownFilePath), src)
  }
  return null
}

export const basenamePath = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index < 0 ? normalized : normalized.slice(index + 1)
}

export const imageMimeFromPath = guessImageMime
