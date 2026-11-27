import { VideoFeedbackContext } from '../workbench/composer/VideoFeedbackContext'
import { useCallback, useEffect, useRef, useState, useContext } from 'react'
import { App, Spin } from 'antd'
import {
  HiArrowTopRightOnSquare,
  HiOutlineExclamationCircle,
  HiOutlineArrowPath
} from 'react-icons/hi2'
import { VideoPlayer, NeutralVideoSkin, Video } from '@videojs/react/video'
import { I18nProvider } from '@videojs/react/i18n'
import '@videojs/react/i18n/locales/zh-CN/register'
import '@videojs/react/video/neutral-skin.css'
import { t, getRendererRuntime } from '../../i18n'
import type { VideoPreviewSnapshot } from '../../../../shared/preview'
import './preview.css'
import VideoWorkbench from './VideoWorkbench'

type Props = { source: string; name?: string; inline?: boolean; unavailable?: boolean }

export default function VideoPreview({ source, name, inline = false, unavailable = false }: Props) {
  const { message } = App.useApp()
  const feedback = useContext(VideoFeedbackContext)
  const [snapshot, setSnapshot] = useState<VideoPreviewSnapshot | null>(null)
  const [failed, setFailed] = useState<'missing' | 'playback' | null>(null)
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  const [editing, setEditing] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const generationRef = useRef(0)
  const attemptsRef = useRef(0)
  const convertingRef = useRef(false)
  const playbackRequestedRef = useRef(false)

  const convert = useCallback(
    async (current: VideoPreviewSnapshot, generation: number): Promise<void> => {
      if (convertingRef.current) return
      convertingRef.current = true
      attemptsRef.current += 1
      setLoading(true)
      try {
        const next = await window.api.previewVideoConvert({
          id: current.id,
          forceTranscode: attemptsRef.current > 1 || current.converted
        })
        if (generationRef.current === generation) setSnapshot(next)
      } catch {
        if (generationRef.current === generation) setFailed('playback')
      } finally {
        if (generationRef.current === generation) convertingRef.current = false
      }
    },
    []
  )

  useEffect(() => {
    const generation = ++generationRef.current
    let resourceId: string | undefined
    let cancelled = false
    attemptsRef.current = 0
    convertingRef.current = false
    playbackRequestedRef.current = false
    setSnapshot(null)
    setFailed(unavailable ? 'missing' : null)
    setLoading(true)
    if (!unavailable) {
      void (async () => {
        if (!/^https:\/\//iu.test(source) && !(await window.api.fileExists(source))) {
          if (!cancelled) setFailed('missing')
          return
        }
        const opened = await window.api.previewVideoOpen({ source })
        resourceId = opened.id
        if (cancelled) {
          await window.api.previewResourceRelease(opened.id)
          return
        }
        setSnapshot(opened)
        const type = opened.codecs
          ? `${opened.mimeType}; codecs="${opened.codecs}"`
          : opened.mimeType
        if (!opened.converted && !document.createElement('video').canPlayType(type)) {
          await convert(opened, generation)
        }
      })().catch(() => {
        if (!cancelled) setFailed('playback')
      })
    }
    return () => {
      cancelled = true
      if (generationRef.current === generation) generationRef.current += 1
      if (resourceId) void window.api.previewResourceRelease(resourceId).catch(() => {})
    }
  }, [convert, retry, source, unavailable])

  useEffect(() => {
    if (snapshot?.status !== 'converting') return
    let cancelled = false
    let fetching = false
    const id = snapshot.id
    const timer = window.setInterval(() => {
      if (fetching) return
      fetching = true
      void window.api
        .previewVideoGet(id)
        .then((next) => {
          if (cancelled) return
          if (next.status === 'failed') setFailed('playback')
          setSnapshot(next)
        })
        .catch(() => {
          if (!cancelled) setFailed('playback')
        })
        .finally(() => {
          fetching = false
        })
    }, 400)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [snapshot?.id, snapshot?.status])

  useEffect(() => {
    const video = videoRef.current
    return () => {
      video?.pause()
    }
  }, [snapshot?.url])

  const openSystem = async (): Promise<void> => {
    const result = /^https:\/\//iu.test(source)
      ? await window.api.openExternal(source)
      : await window.api.openPath(source)
    if (!result.success) void message.error(result.error || t(($) => $.workbench.couldNotOpen))
  }
  const converting = snapshot?.status === 'converting'
  useEffect(() => {
    if (
      (feedback?.navigation?.node.filePath === source ||
        feedback?.navigation?.node.versionPath === source) &&
      !inline
    )
      setEditing(true)
  }, [
    feedback?.navigation?.requestId,
    feedback?.navigation?.node.filePath,
    feedback?.navigation?.node.versionPath,
    source,
    inline
  ])
  const ready = snapshot?.status === 'ready'
  if (editing && !inline && ready && snapshot && !failed)
    return (
      <div className="flex h-full w-full flex-col">
        <div className="flex justify-end border-b border-[var(--notion-line)] px-4 py-2">
          <button
            type="button"
            className="cursor-pointer rounded-md px-3 py-1 text-[13px] hover:bg-[var(--notion-surface-hover)]"
            onClick={() => setEditing(false)}
          >
            预览
          </button>
          <span className="rounded-md bg-[var(--notion-blue-bg)] px-3 py-1 text-[13px] text-[var(--notion-blue)]">
            编辑
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <VideoWorkbench
            source={source}
            snapshot={snapshot}
            onError={() => {
              setEditing(false)
              void convert(snapshot, generationRef.current)
            }}
          />
        </div>
      </div>
    )
  return (
    <div
      className={inline ? 'nc-video-inline' : 'nc-video-canvas'}
      data-testid="workbench-video-preview"
      style={{ position: 'relative' }}
    >
      {!inline && ready && !failed ? (
        <button
          type="button"
          className="absolute right-4 top-3 z-30 cursor-pointer rounded-md border border-[var(--notion-line)] bg-[var(--notion-page)] px-3 py-1.5 text-[13px] text-[var(--notion-text)]"
          disabled={/^https:\/\//iu.test(source)}
          title={/^https:\/\//iu.test(source) ? '保存到本地后可编辑' : undefined}
          onClick={() => {
            videoRef.current?.pause()
            setEditing(true)
          }}
        >
          编辑
        </button>
      ) : null}
      <div
        className="nc-video-frame"
        data-video-state={failed || (converting ? 'converting' : loading ? 'loading' : 'ready')}
      >
        {ready && !failed ? (
          <I18nProvider locale={getRendererRuntime().locale}>
            <VideoPlayer defaultPlaybackRates={[0.5, 1, 1.25, 1.5, 2]}>
              <NeutralVideoSkin className="nc-video-skin">
                <Video
                  ref={videoRef}
                  src={snapshot.url}
                  playsInline
                  preload="metadata"
                  aria-label={name || t(($) => $.editors.videoPreview)}
                  onPlay={() => {
                    playbackRequestedRef.current = true
                  }}
                  onLoadedData={() => {
                    setLoading(false)
                    if (playbackRequestedRef.current) void videoRef.current?.play().catch(() => {})
                  }}
                  onError={() => {
                    if (attemptsRef.current < 2) void convert(snapshot, generationRef.current)
                    else setFailed('playback')
                  }}
                />
              </NeutralVideoSkin>
            </VideoPlayer>
          </I18nProvider>
        ) : null}
        {loading || converting || failed ? (
          <div className="nc-video-overlay" role="status" aria-live="polite">
            {failed ? (
              <>
                <HiOutlineExclamationCircle className="h-6 w-6" aria-hidden />
                <strong>
                  {failed === 'missing'
                    ? t(($) => $.editors.videoUnavailable)
                    : t(($) => $.editors.videoCannotPlay)}
                </strong>
                <span>
                  {failed === 'missing'
                    ? t(($) => $.editors.videoMayHaveMoved)
                    : t(($) => $.editors.videoRetryOrOpen)}
                </span>
                {failed === 'playback' ? (
                  <div className="nc-video-error-actions">
                    <button type="button" onClick={() => setRetry((value) => value + 1)}>
                      <HiOutlineArrowPath className="h-3.5 w-3.5" />
                      {t(($) => $.common.retry)}
                    </button>
                    <button type="button" onClick={() => void openSystem()}>
                      {t(($) => $.editors.openVideoWithSystem)}
                      <HiArrowTopRightOnSquare className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <Spin size="small" />
                <span>
                  {converting
                    ? t(($) => $.editors.preparingVideo)
                    : t(($) => $.editors.loadingVideo)}
                </span>
                {converting && typeof snapshot.progress === 'number' ? (
                  <progress
                    max={100}
                    value={snapshot.progress}
                    aria-label={t(($) => $.editors.preparingVideo)}
                  />
                ) : null}
                {converting && typeof snapshot.progress === 'number' ? (
                  <span>{Math.floor(snapshot.progress)}%</span>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
