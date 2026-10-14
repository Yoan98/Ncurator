import React, { useEffect, useRef, useState } from 'react'
import { HiPhoto } from 'react-icons/hi2'
import { workbenchSelectors } from '../../testing/selectors'
import type { ImageLightboxImage } from './ImageLightbox'
import {
  guessImageMimeType,
  isReadImageRemotePath,
  readImageDisplayName
} from '../../../../shared/workbench/readImageThumbUtils'

type ReadImageThumbsProps = {
  paths: string[]
  onPreviewImage?: (image: ImageLightboxImage) => void
}

const ReadImageThumbs: React.FC<ReadImageThumbsProps> = ({ paths, onPreviewImage }) => {
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
  const previewUrlsRef = useRef<Record<string, string>>({})
  const blobUrlsRef = useRef<Set<string>>(new Set())
  const pathsKey = paths.join('\0')

  useEffect(() => {
    let cancelled = false
    const nextPaths = pathsKey.length > 0 ? pathsKey.split('\0') : []
    const pathSet = new Set(nextPaths)

    Object.entries(previewUrlsRef.current).forEach(([pathValue, url]) => {
      if (pathSet.has(pathValue)) return
      if (blobUrlsRef.current.has(url)) {
        URL.revokeObjectURL(url)
        blobUrlsRef.current.delete(url)
      }
      delete previewUrlsRef.current[pathValue]
    })

    nextPaths.forEach((pathValue) => {
      if (previewUrlsRef.current[pathValue]) return
      if (isReadImageRemotePath(pathValue)) {
        previewUrlsRef.current = { ...previewUrlsRef.current, [pathValue]: pathValue }
        if (!cancelled) setPreviewUrls({ ...previewUrlsRef.current })
        return
      }
      void window.api
        .readFile(pathValue)
        .then((bytes) => {
          if (cancelled || previewUrlsRef.current[pathValue]) return
          const arrayBuffer = new ArrayBuffer(bytes.byteLength)
          new Uint8Array(arrayBuffer).set(bytes)
          const blob = new Blob([arrayBuffer], { type: guessImageMimeType(pathValue) })
          const url = URL.createObjectURL(blob)
          blobUrlsRef.current.add(url)
          previewUrlsRef.current = { ...previewUrlsRef.current, [pathValue]: url }
          setPreviewUrls({ ...previewUrlsRef.current })
        })
        .catch(() => {
          // Preview failure should not block the activity row.
        })
    })

    if (!cancelled) setPreviewUrls({ ...previewUrlsRef.current })

    return () => {
      cancelled = true
    }
  }, [pathsKey])

  useEffect(() => {
    const blobUrls = blobUrlsRef.current
    return () => {
      blobUrls.forEach((url) => URL.revokeObjectURL(url))
      blobUrls.clear()
      previewUrlsRef.current = {}
    }
  }, [])

  if (paths.length === 0) return null

  return (
    <div className="mt-1 flex max-w-full flex-nowrap gap-2 overflow-x-auto overflow-y-hidden pb-0.5">
      {paths.map((pathValue, index) => {
        const name = readImageDisplayName(pathValue)
        const src = previewUrls[pathValue]
        return (
          <button
            key={`${pathValue}-${String(index)}`}
            type="button"
            className="h-[54px] w-[54px] shrink-0 overflow-hidden rounded-[8px] border border-[#E5E4E0] bg-white p-0 text-left shadow-[0_1px_2px_rgba(15,15,15,0.04)] transition hover:border-[#D8D7D3]"
            title={name}
            data-testid={`${workbenchSelectors.readImageThumbPrefix}-${String(index)}`}
            onClick={() => {
              if (!src) return
              onPreviewImage?.({ name, src })
            }}
          >
            <span className="flex h-full w-full items-center justify-center bg-[#F4F4F2] text-[#787774]">
              {src ? (
                <img src={src} alt={name} className="h-full w-full object-cover" />
              ) : (
                <HiPhoto className="h-5 w-5" />
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export default ReadImageThumbs
