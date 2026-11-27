import { useContext, useEffect, useState } from 'react'
import { Image } from 'antd'
import { HiOutlineFilm } from 'react-icons/hi2'
import type { VideoFeedbackNode } from '../../../../../shared/types'
import { videoFeedbackLabel, videoFeedbackText } from '../../../../../shared/videoFeedback'
import { VideoFeedbackContext } from './VideoFeedbackContext'

export default function VideoFeedbackToken({ node }: { node: VideoFeedbackNode }) {
  const state = useContext(VideoFeedbackContext)
  const [url, setUrl] = useState('')
  useEffect(() => {
    let active = true
    let objectUrl = ''
    void window.api
      .readFile(node.screenshotPath)
      .then((bytes) => {
        objectUrl = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'image/png' }))
        if (active) setUrl(objectUrl)
        else URL.revokeObjectURL(objectUrl)
      })
      .catch(() => {})
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [node.screenshotPath])
  return (
    <span
      className="my-1 inline-flex max-w-full flex-col gap-1 align-middle"
      data-role="video-feedback"
    >
      <button
        type="button"
        className="inline-flex w-fit max-w-full items-center gap-1 rounded-md bg-[var(--notion-blue-bg)] px-1.5 py-0.5 text-[var(--notion-blue)]"
        onClick={() => state?.navigate(node)}
      >
        <HiOutlineFilm className="h-4 w-4" />
        {videoFeedbackLabel(node)}
      </button>
      {url ? (
        <Image
          src={url}
          width={180}
          style={{ maxHeight: 110, objectFit: 'contain', borderRadius: 6 }}
          alt={videoFeedbackLabel(node)}
        />
      ) : null}
      <span className="whitespace-pre-wrap">{videoFeedbackText(node)}</span>
    </span>
  )
}
