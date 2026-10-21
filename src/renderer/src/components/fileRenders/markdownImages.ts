import { t } from '../../i18n'
import {
  basenamePath,
  imageMimeFromPath,
  resolveMarkdownImageLocalPath
} from '../../../../shared/markdownImagePath'

const LOCAL_PATH_ATTR = 'data-ncurator-local-path'

export type MarkdownImageBlobCache = Map<string, string>

export const revokeMarkdownImageBlobs = (cache: MarkdownImageBlobCache): void => {
  for (const url of cache.values()) URL.revokeObjectURL(url)
  cache.clear()
}

export const hydrateMarkdownImages = async (input: {
  root: HTMLElement
  markdownFilePath: string
  cache: MarkdownImageBlobCache
}): Promise<void> => {
  const images = Array.from(input.root.querySelectorAll('img'))
  await Promise.all(
    images.map(async (img) => {
      const rawSrc = img.getAttribute('src') || ''
      if (!rawSrc || rawSrc.startsWith('blob:') || rawSrc.startsWith('data:')) return

      const absolutePath = resolveMarkdownImageLocalPath(input.markdownFilePath, rawSrc)
      if (!absolutePath) return

      let blobUrl = input.cache.get(absolutePath)
      if (!blobUrl) {
        const exists = await window.api.fileExists(absolutePath)
        if (!exists) return
        const bytes = await window.api.readFile(absolutePath)
        const copy = new Uint8Array(bytes.byteLength)
        copy.set(bytes)
        const blob = new Blob([copy], { type: imageMimeFromPath(absolutePath) })
        blobUrl = URL.createObjectURL(blob)
        input.cache.set(absolutePath, blobUrl)
      }

      if (img.getAttribute('src') === blobUrl) return
      img.setAttribute('src', blobUrl)
      img.setAttribute(LOCAL_PATH_ATTR, absolutePath)
      img.setAttribute('alt', img.getAttribute('alt') || basenamePath(absolutePath))
    })
  )
}

export const resolvePreviewImageName = (img: HTMLImageElement): string => {
  const localPath = img.getAttribute(LOCAL_PATH_ATTR)
  if (localPath) return basenamePath(localPath)
  const alt = (img.getAttribute('alt') || '').trim()
  if (alt) return alt
  return t(($) => $.editors.image)
}

export const isImageLoaded = (img: HTMLImageElement): boolean =>
  img.complete && img.naturalWidth > 0
