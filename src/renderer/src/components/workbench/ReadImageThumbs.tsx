import React, { useEffect, useState } from 'react'
import { HiPhoto } from 'react-icons/hi2'
import { workbenchSelectors } from '../../testing/selectors'
import type { ImageLightboxImage } from './ImageLightbox'
import {
  isReadImageRemotePath,
  readImageDisplayName
} from '../../../../shared/workbench/readImageThumbUtils'
import { loadLocalImageUrl } from '../../utils/localImageObjectUrl'

type ReadImageThumbsProps = {
  paths: string[]
  onPreviewImage?: (image: ImageLightboxImage) => void
}

const ReadImageThumbs: React.FC<ReadImageThumbsProps> = ({ paths, onPreviewImage }) => {
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
  const pathsKey = paths.join('\0')

  useEffect(() => {
    let cancelled = false
    const localPaths = pathsKey.length > 0 ? pathsKey.split('\0') : []

    void Promise.all(
      localPaths
        .filter((pathValue) => !isReadImageRemotePath(pathValue))
        .map(async (pathValue) => ({ pathValue, url: await loadLocalImageUrl(pathValue) }))
    ).then((entries) => {
      if (cancelled) return
      setPreviewUrls((previous) => {
        const next = { ...previous }
        for (const entry of entries) {
          if (entry.url) next[entry.pathValue] = entry.url
        }
        return next
      })
    })

    return () => {
      cancelled = true
    }
  }, [pathsKey])

  if (paths.length === 0) return null

  return (
    <div className="mt-1 flex max-w-full flex-nowrap gap-2 overflow-x-auto overflow-y-hidden pb-0.5">
      {paths.map((pathValue, index) => {
        const name = readImageDisplayName(pathValue)
        const src = isReadImageRemotePath(pathValue) ? pathValue : previewUrls[pathValue]
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
