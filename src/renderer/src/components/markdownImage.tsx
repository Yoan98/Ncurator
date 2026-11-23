import React, { useEffect, useState } from 'react'
import FileIcon from './FileIcon'
import { t } from '../i18n'
import { basenamePath, resolveMarkdownImageLocalPath } from '../../../shared/markdownImagePath'
import { readImageDisplayName } from '../../../shared/workbench/readImageThumbUtils'
import { loadLocalImageUrl } from '../utils/localImageObjectUrl'

/** Structurally matches the workbench lightbox payload without importing it. */
export type MarkdownPreviewImage = {
  name: string
  src: string
}

type ResolvedImageSource =
  | { kind: 'none' }
  | { kind: 'remote'; url: string }
  | { kind: 'local'; path: string }

const REMOTE_URL_RE = /^https?:\/\//i
const ABSOLUTE_PATH_RE = /^(?:[a-zA-Z]:[\\/]|\/)/

const resolveImageSource = (
  src: string | undefined,
  sourceFilePath: string | undefined
): ResolvedImageSource => {
  const raw = (src || '').trim()
  if (!raw) return { kind: 'none' }
  if (REMOTE_URL_RE.test(raw)) return { kind: 'remote', url: raw }

  const localPath = resolveMarkdownImageLocalPath(sourceFilePath || '', raw)
  if (!localPath) return { kind: 'none' }
  // Without a containing Markdown file there is no base directory to resolve
  // relative destinations against; such images degrade to a reference chip.
  if (!sourceFilePath && !ABSOLUTE_PATH_RE.test(localPath)) return { kind: 'none' }
  return { kind: 'local', path: localPath }
}

export type MarkdownImageProps = {
  src?: string
  alt?: string
  title?: string
  /** Path of the Markdown file holding the image, used to resolve a relative src. */
  sourceFilePath?: string
  /** Delivery marked the target unreachable; skip loading and show a chip. */
  unavailable?: boolean
  onOpen?: (image: MarkdownPreviewImage) => void
}

const MarkdownImageFallback: React.FC<{
  label: string
  title?: string
}> = ({ label, title }) => (
  <span className="markdown-reference-unavailable" title={title}>
    <span className="markdown-reference-icon">
      <FileIcon kind="image" className="h-[18px] w-[18px] shrink-0" />
    </span>
    <span className="min-w-0 break-words [overflow-wrap:anywhere]">{label}</span>
  </span>
)

const MarkdownImage: React.FC<MarkdownImageProps> = ({
  src,
  alt,
  title,
  sourceFilePath,
  unavailable,
  onOpen
}) => {
  const source = resolveImageSource(src, sourceFilePath)
  const localPath = source.kind === 'local' ? source.path : null
  const remoteUrl = source.kind === 'remote' ? source.url : null
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(remoteUrl)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (unavailable || !localPath) {
      setResolvedUrl(unavailable ? null : remoteUrl)
      setFailed(false)
      return
    }

    let cancelled = false
    setResolvedUrl(null)
    setFailed(false)
    void loadLocalImageUrl(localPath).then((url) => {
      if (cancelled) return
      if (!url) {
        setFailed(true)
        return
      }
      setResolvedUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [localPath, remoteUrl, unavailable])

  const fallbackLabel =
    (alt || '').trim() ||
    (localPath ? basenamePath(localPath) : '') ||
    (remoteUrl ? readImageDisplayName(remoteUrl) : '') ||
    t(($) => $.editors.image)

  if (unavailable || source.kind === 'none' || failed) {
    return (
      <MarkdownImageFallback
        label={fallbackLabel}
        title={unavailable || failed ? t(($) => $.common.linkUnavailable) : title}
      />
    )
  }

  if (!resolvedUrl) {
    return (
      <span className="markdown-image" data-image-state="loading">
        <span className="markdown-image-frame markdown-image-frame--placeholder" aria-hidden>
          <FileIcon kind="image" className="h-5 w-5" />
        </span>
      </span>
    )
  }

  const name = localPath ? basenamePath(localPath) : readImageDisplayName(remoteUrl || '')
  const caption = (alt || '').trim() === name ? undefined : (alt || '').trim()

  return (
    <span className="markdown-image" data-image-state="ready">
      {onOpen ? (
        <button
          type="button"
          className="markdown-image-frame"
          title={title || name}
          onClick={() => onOpen({ name, src: resolvedUrl })}
        >
          <img src={resolvedUrl} alt={alt || name} loading="lazy" className="markdown-image-el" />
        </button>
      ) : (
        <span className="markdown-image-frame" title={title || name}>
          <img src={resolvedUrl} alt={alt || name} loading="lazy" className="markdown-image-el" />
        </span>
      )}
      {caption ? <span className="markdown-image-caption">{caption}</span> : null}
    </span>
  )
}

export default MarkdownImage
