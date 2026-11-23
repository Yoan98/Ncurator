/**
 * Single source of truth for image file formats the app can render inline.
 *
 * Callers: markdown image resolution (`markdownImagePath`), blob URL creation
 * (`localImageObjectUrl` / `ReadImageThumbs`), file-preview registration
 * (`capabilities`) and reference icons (`fileIcons`). Add a format here only.
 */

export const IMAGE_FILE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'avif',
  'ico'
] as const

export type ImageFileExtension = (typeof IMAGE_FILE_EXTENSIONS)[number]

const IMAGE_MIME_BY_EXTENSION: Record<ImageFileExtension, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  ico: 'image/x-icon'
}

/** Lowercase extension without the dot; empty for dotfiles and extensionless names. */
export const fileExtensionOf = (pathOrName: string): string => {
  let pathname = String(pathOrName || '')
  if (/^https?:\/\//iu.test(pathname)) {
    try {
      pathname = new URL(pathname).pathname
    } catch {
      return ''
    }
  }
  const base = pathname.split(/[\\/]/u).pop()
  if (!base) return ''
  const dotIndex = base.lastIndexOf('.')
  return dotIndex > 0 ? base.slice(dotIndex + 1).toLowerCase() : ''
}

export const isImageFileExtension = (extension: string): boolean =>
  Object.prototype.hasOwnProperty.call(IMAGE_MIME_BY_EXTENSION, extension.trim().toLowerCase())

export const isImageFilePath = (pathOrName: string): boolean =>
  isImageFileExtension(fileExtensionOf(pathOrName))

export const imageMimeFromExtension = (extension: string): string => {
  const normalized = extension.trim().toLowerCase()
  return isImageFileExtension(normalized)
    ? IMAGE_MIME_BY_EXTENSION[normalized as ImageFileExtension]
    : 'application/octet-stream'
}

export const imageMimeFromPath = (pathOrName: string): string =>
  imageMimeFromExtension(fileExtensionOf(pathOrName))
