import {
  useContext,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { App, Tooltip } from 'antd'
import {
  HiOutlineChatBubbleLeftEllipsis,
  HiOutlineStop,
  HiOutlineArrowUpRight,
  HiOutlinePlay,
  HiOutlinePause,
  HiOutlineChevronLeft,
  HiOutlineChevronRight,
  HiOutlineTrash,
  HiOutlineChevronDown
} from 'react-icons/hi2'
import type { VideoPreviewSnapshot, VideoPreviewFrame } from '../../../../shared/preview'
import type { VideoFeedbackNode } from '../../../../shared/types'
import { snapVideoTime } from '../../../../shared/videoFeedback'
import { VideoFeedbackContext } from '../workbench/composer/VideoFeedbackContext'
import './video-workbench.css'
import { registerVideoFeedbackWriter } from './pendingVideoFeedback'

type Mark = NonNullable<VideoFeedbackNode['geometry']>[number] & { text: string }
type Draft = {
  id: string
  time: number
  range?: { startSeconds: number; endSeconds: number }
  text: string
  marks: Mark[]
  added: boolean
}
type Drag = {
  number: number
  handle: 'new' | 'move' | 'start' | 'end' | 'nw' | 'ne' | 'sw' | 'se'
  origin: { x: number; y: number }
  mark: Mark
}
const fromNode = (node: VideoFeedbackNode): Draft => ({
  id: node.id,
  time: node.timeSeconds,
  range: node.range,
  text: node.frameText || '',
  added: true,
  marks: (node.geometry || []).map((mark) => ({
    ...mark,
    text: node.annotations.find((item) => item.number === mark.number)?.text || ''
  }))
})
const clock = (seconds: number): string =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toFixed(2).padStart(5, '0')}`
const bounded = (value: number): number => Math.max(0, Math.min(1, value))

export default function VideoWorkbench({
  source,
  snapshot,
  onError
}: {
  source: string
  snapshot: VideoPreviewSnapshot
  onError: () => void
}) {
  const state = useContext(VideoFeedbackContext)
  const { message } = App.useApp()
  const video = useRef<HTMLVideoElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const timeline = useRef<HTMLDivElement>(null)
  const holder = useRef<HTMLDivElement>(null)
  const [stageSize, setStageSize] = useState({ width: 320, height: 180 })
  const flushing = useRef(false)
  const saveGeneration = useRef(new Map<string, number>())
  const [time, setTime] = useState(0)
  const [paused, setPaused] = useState(true)
  const [rate, setRate] = useState(1)
  const [tool, setTool] = useState<'text' | 'rectangle' | 'arrow'>('text')
  const [active, setActive] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [frames, setFrames] = useState<VideoPreviewFrame[]>([])
  const [drafts, setDrafts] = useState<Draft[]>(
    () =>
      state?.nodes
        .filter(
          (node) =>
            node.filePath === (snapshot.originalPath || source) && node.version === snapshot.version
        )
        .map(fromNode) || []
  )
  const draftsRef = useRef(drafts)
  draftsRef.current = drafts
  const drag = useRef<Drag | null>(null)
  const seeking = useRef(false)
  const mounted = useRef(true)
  const counter = useRef(
    Math.max(
      0,
      ...(state?.nodes.flatMap((node) => node.annotations.map((item) => item.number)) || [])
    ) + 1
  )
  const w = snapshot.width || 1280,
    h = snapshot.height || 720,
    duration = snapshot.duration || 0,
    fps = snapshot.fps || 30
  const markScale = w / Math.max(1, stageSize.width)
  const badgePosition = (x: number, y: number, radius: number): { x: number; y: number } => {
    const top = y < 2 * radius + 6 * markScale
    return {
      x: Math.max(radius, Math.min(w - radius, top ? x + 2 * radius + 6 * markScale : x)),
      y: Math.max(radius, Math.min(h - radius, top ? y : y - radius - 6 * markScale))
    }
  }
  const current = drafts.find((item) => Math.abs(item.time - time) < 0.5 / fps)
  const pending = current || { id: crypto.randomUUID(), time, text: '', marks: [], added: false }
  const selected = current?.marks.find((mark) => mark.number === active)
  const locked = !state || state.locked
  useEffect(() => {
    const element = holder.current
    if (!element) return
    const resize = () => {
      const width = Math.min(element.clientWidth, (element.clientHeight * w) / h)
      setStageSize({ width, height: (width * h) / w })
    }
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    resize()
    return () => observer.disconnect()
  }, [w, h])

  useEffect(() => {
    mounted.current = true
    let cancelled = false
    void window.api
      .previewVideoFrames(snapshot.id)
      .then((items) => {
        if (!cancelled) setFrames(items)
      })
      .catch(() => {})
    return () => {
      mounted.current = false
      cancelled = true
    }
  }, [snapshot.id])
  useEffect(() => {
    const navigation = state?.navigation
    if (
      !navigation ||
      (navigation.node.filePath !== source && navigation.node.versionPath !== source)
    )
      return
    const node = navigation.node
    setDrafts((items) =>
      items.some((item) => item.id === node.id) ? items : [...items, fromNode(node)]
    )
    if (video.current) {
      video.current.pause()
      video.current.currentTime = node.timeSeconds
      setTime(node.timeSeconds)
    }
  }, [state?.navigation, source])

  const seek = (next: number): void => {
    if (!video.current) return
    video.current.pause()
    const target = Math.max(0, Math.min(duration - 1 / fps, next))
    video.current.currentTime = target
    setTime(target)
    setActive(null)
  }
  const update = (change: Partial<Draft>): void =>
    setDrafts((items) => {
      const item = items.find((entry) => Math.abs(entry.time - time) < 0.5 / fps) || pending
      return [...items.filter((entry) => entry.id !== item.id), { ...item, ...change }]
    })
  const updateMark = (number: number, change: Partial<Mark>): void =>
    update({
      marks: pending.marks.map((mark) => (mark.number === number ? { ...mark, ...change } : mark))
    })

  const screenshot = async (draft: Draft, navigate = false): Promise<VideoFeedbackNode> => {
    const player = video.current
    if (player && navigate) {
      player.pause()
      if (Math.abs(player.currentTime - draft.time) > 0.5 / fps) player.currentTime = draft.time
    }
    if (!player || !player.paused || Math.abs(player.currentTime - draft.time) > 0.5 / fps)
      throw new Error('请暂停在对应画面后添加意见')
    if (
      draft.range &&
      (draft.range.startSeconds < 0 ||
        draft.range.endSeconds <= draft.range.startSeconds ||
        draft.range.endSeconds > duration)
    )
      throw new Error('请选择有效的视频时间段')
    if (player.seeking)
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          player.removeEventListener('seeked', done)
          reject(new Error('视频定位超时'))
        }, 15000)
        const done = () => {
          clearTimeout(timer)
          resolve()
        }
        player.addEventListener('seeked', done, { once: true })
      })
    if (player.readyState < 2)
      await new Promise<void>((resolve, reject) => {
        const done = () => {
          clearTimeout(timer)
          player.removeEventListener('loadeddata', done)
          resolve()
        }
        const timer = setTimeout(() => {
          player.removeEventListener('loadeddata', done)
          reject(new Error('视频画面加载超时'))
        }, 15000)
        player.addEventListener('loadeddata', done, { once: true })
      })
    if (Math.abs(player.currentTime - draft.time) > 0.5 / fps || player.readyState < 2)
      throw new Error('视频画面尚未就绪')
    const canvas = document.createElement('canvas')
    const captureScale = Math.max(1, Math.min(4, 720 / h))
    canvas.width = Math.round(w * captureScale)
    canvas.height = Math.round(h * captureScale)
    const ctx = canvas.getContext('2d')!
    ctx.scale(captureScale, captureScale)
    ctx.drawImage(player, 0, 0, w, h)
    const color =
      getComputedStyle(stage.current!).getPropertyValue('--notion-blue').trim() || '#2f5f8f'
    const marks = draft.marks.filter((mark) => mark.text.trim())
    const scale = markScale
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = 3 * scale
    for (const mark of marks) {
      const x = mark.x1 * w,
        y = mark.y1 * h,
        x2 = mark.x2 * w,
        y2 = mark.y2 * h
      if (mark.kind === 'rectangle')
        ctx.strokeRect(Math.min(x, x2), Math.min(y, y2), Math.abs(x2 - x), Math.abs(y2 - y))
      else {
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x2, y2)
        ctx.stroke()
        const angle = Math.atan2(y2 - y, x2 - x)
        ctx.beginPath()
        ctx.moveTo(x2, y2)
        ctx.lineTo(
          x2 - 16 * scale * Math.cos(angle - 0.45),
          y2 - 16 * scale * Math.sin(angle - 0.45)
        )
        ctx.moveTo(x2, y2)
        ctx.lineTo(
          x2 - 16 * scale * Math.cos(angle + 0.45),
          y2 - 16 * scale * Math.sin(angle + 0.45)
        )
        ctx.stroke()
      }
      const radius = 11 * scale
      const badge = badgePosition(x, y, radius)
      ctx.beginPath()
      ctx.arc(badge.x, badge.y, radius, 0, 2 * Math.PI)
      ctx.fill()
      ctx.save()
      ctx.fillStyle = '#fff'
      ctx.font = `${12 * scale}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(mark.number), badge.x, badge.y)
      ctx.restore()
    }
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('无法生成截图'))),
        'image/png'
      )
    )
    const frozen = await window.api.previewVideoFreeze({
      id: snapshot.id,
      partnerId: state!.partnerId
    })
    const saved = await window.api.attachmentSaveFile({
      partnerId: state!.partnerId,
      assetBucketId: crypto.randomUUID(),
      name: `video-${draft.id}.png`,
      bytes: new Uint8Array(await blob.arrayBuffer()),
      mimeType: 'image/png',
      kind: 'image'
    })
    if (!saved.success || !saved.attachment) throw new Error(saved.error || '截图保存失败')
    return {
      kind: 'video_feedback',
      id: draft.id,
      filePath:
        state?.navigation?.node.versionPath === source
          ? state.navigation.node.filePath
          : snapshot.originalPath || source,
      version: frozen.version,
      versionPath: frozen.versionPath,
      timeSeconds: draft.time,
      range: draft.range,
      screenshotPath: saved.attachment.path,
      screenshotSize: { width: canvas.width, height: canvas.height, sizeBytes: blob.size },
      frameText: draft.text.trim() || undefined,
      annotations: marks.map((mark) => ({ number: mark.number, kind: mark.kind, text: mark.text })),
      geometry: marks.map((mark) => ({
        number: mark.number,
        kind: mark.kind,
        x1: mark.x1,
        y1: mark.y1,
        x2: mark.x2,
        y2: mark.y2
      }))
    }
  }
  const commit = async (draft: Draft, automatic = false, strict = false): Promise<void> => {
    if (automatic && !strict && flushing.current) return
    if (locked || (saving && !strict)) {
      if (strict) throw new Error('视频意见暂时无法发送')
      return
    }
    if (!draft.text.trim() && !draft.marks.some((mark) => mark.text.trim())) {
      if (draft.added) state?.remove(draft.id)
      return
    }
    if (!automatic) setSaving(true)
    const generation = (saveGeneration.current.get(draft.id) || 0) + 1
    saveGeneration.current.set(draft.id, generation)
    try {
      const node = await screenshot(draft, strict)
      if (!mounted.current || saveGeneration.current.get(draft.id) !== generation) return
      state?.save(node)
      setDrafts((items) =>
        items.map((item) => (item.id === draft.id ? { ...item, added: true } : item))
      )
    } catch (error) {
      if (strict) throw error
      if (!automatic) void message.error(error instanceof Error ? error.message : String(error))
    } finally {
      if (mounted.current && !automatic) setSaving(false)
    }
  }
  useEffect(() => {
    setDrafts((items) =>
      items.some((item) => item.added && !state?.nodes.some((node) => node.id === item.id))
        ? items.map((item) =>
            item.added && !state?.nodes.some((node) => node.id === item.id)
              ? { ...item, id: crypto.randomUUID(), added: false }
              : item
          )
        : items
    )
  }, [state?.nodes])
  const commitRef = useRef(commit)
  commitRef.current = commit
  const currentRef = useRef(current)
  currentRef.current = current
  const syncSignature = current
    ? JSON.stringify({ text: current.text, marks: current.marks, range: current.range })
    : ''
  useEffect(() => {
    const draft = currentRef.current
    if (!draft?.added || !paused) return
    const timer = setTimeout(() => void commitRef.current(draft, true), 300)
    return () => clearTimeout(timer)
  }, [syncSignature, paused])

  useEffect(
    () =>
      registerVideoFeedbackWriter(snapshot.id, async () => {
        const player = video.current,
          position = player?.currentTime
        flushing.current = true
        try {
          for (const draft of draftsRef.current.filter((item) => item.added))
            await commitRef.current(draft, true, true)
        } finally {
          flushing.current = false
          if (player && position !== undefined) player.currentTime = position
        }
      }),
    [snapshot.id]
  )

  const point = (event: ReactPointerEvent): { x: number; y: number } => {
    const bounds = stage.current!.getBoundingClientRect()
    return {
      x: bounded((event.clientX - bounds.left) / bounds.width),
      y: bounded((event.clientY - bounds.top) / bounds.height)
    }
  }
  const begin = (event: ReactPointerEvent, mark?: Mark, handle: Drag['handle'] = 'move'): void => {
    if (locked || !paused || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const origin = point(event)
    if (!mark) {
      if (tool === 'text') {
        setCollapsed(false)
        return
      }
      counter.current = Math.max(
        counter.current,
        1 +
          Math.max(
            0,
            ...(state?.nodes.flatMap((node) => node.annotations.map((item) => item.number)) || [])
          )
      )
      mark = {
        number: counter.current++,
        kind: tool,
        x1: origin.x,
        y1: origin.y,
        x2: origin.x,
        y2: origin.y,
        text: ''
      }
      update({ marks: [...pending.marks, mark] })
      handle = 'new'
    }
    drag.current = { number: mark.number, handle, origin, mark: { ...mark } }
    stage.current!.setPointerCapture(event.pointerId)
  }
  const move = (event: ReactPointerEvent): void => {
    const gesture = drag.current
    if (!gesture) return
    const p = point(event),
      m = gesture.mark,
      dx = p.x - gesture.origin.x,
      dy = p.y - gesture.origin.y
    let next = { ...m }
    if (gesture.handle === 'move') {
      const x = Math.max(-Math.min(m.x1, m.x2), Math.min(1 - Math.max(m.x1, m.x2), dx)),
        y = Math.max(-Math.min(m.y1, m.y2), Math.min(1 - Math.max(m.y1, m.y2), dy))
      next = { ...m, x1: m.x1 + x, x2: m.x2 + x, y1: m.y1 + y, y2: m.y2 + y }
    } else if (gesture.handle === 'start') next = { ...m, x1: p.x, y1: p.y }
    else if (gesture.handle === 'new' || gesture.handle === 'end') next = { ...m, x2: p.x, y2: p.y }
    else {
      const left = gesture.handle.includes('w'),
        top = gesture.handle.includes('n')
      next = {
        ...m,
        x1: left ? p.x : Math.min(m.x1, m.x2),
        x2: left ? Math.max(m.x1, m.x2) : p.x,
        y1: top ? p.y : Math.min(m.y1, m.y2),
        y2: top ? Math.max(m.y1, m.y2) : p.y
      }
    }
    setDrafts((items) =>
      items.map((item) =>
        item.id === pending.id
          ? {
              ...item,
              marks: item.marks.map((mark) => (mark.number === gesture.number ? next : mark))
            }
          : item
      )
    )
  }
  const end = (event: ReactPointerEvent): void => {
    const gesture = drag.current
    if (!gesture) return
    drag.current = null
    if (stage.current?.hasPointerCapture(event.pointerId))
      stage.current.releasePointerCapture(event.pointerId)
    setActive(gesture.number)
  }
  const seekPointer = (event: ReactPointerEvent): void => {
    const rect = timeline.current!.getBoundingClientRect()
    const raw = bounded((event.clientX - rect.left) / rect.width) * duration
    seek(
      snapVideoTime(
        raw,
        drafts.map((item) => item.time),
        duration,
        rect.width,
        event.altKey
      )
    )
  }

  return (
    <div className="nc-video-workbench" data-testid="video-workbench">
      <div className="nc-video-annotation-tools" role="toolbar" aria-label="视频意见">
        {(
          [
            ['text', '文字意见', HiOutlineChatBubbleLeftEllipsis],
            ['rectangle', '框选', HiOutlineStop],
            ['arrow', '箭头', HiOutlineArrowUpRight]
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            aria-pressed={tool === key}
            disabled={locked}
            onClick={() => {
              video.current?.pause()
              setTool(key)
              if (key === 'text') setCollapsed(false)
            }}
          >
            <Icon />
            {label}
          </button>
        ))}
      </div>
      <div ref={holder} className="nc-video-stage-holder">
        <div
          ref={stage}
          className="nc-video-stage"
          style={stageSize}
          onPointerDown={(event) => begin(event)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={() => {
            drag.current = null
          }}
        >
          <video
            ref={video}
            src={snapshot.url}
            crossOrigin="anonymous"
            preload="auto"
            playsInline
            onError={onError}
            onTimeUpdate={() => {
              if (video.current && !seeking.current) setTime(video.current.currentTime)
            }}
            onPlay={() => {
              setPaused(false)
              setActive(null)
            }}
            onPause={() => {
              setPaused(true)
              if (video.current) setTime(video.current.currentTime)
            }}
          />
          {paused ? (
            <svg viewBox={`0 0 ${w} ${h}`} className="nc-video-marks" aria-label="画面标注">
              <defs>
                <marker
                  id={`video-arrow-${snapshot.id}`}
                  markerWidth="10"
                  markerHeight="10"
                  refX="8"
                  refY="5"
                  orient="auto-start-reverse"
                >
                  <path d="M1 1L8 5L1 9" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </marker>
              </defs>
              {(current?.marks || []).map((mark) => {
                const x = mark.x1 * w,
                  y = mark.y1 * h,
                  x2 = mark.x2 * w,
                  y2 = mark.y2 * h
                const filled = !!mark.text.trim()
                const selected = active === mark.number
                const radius = 11 * markScale
                const badge = badgePosition(x, y, radius)
                return (
                  <g
                    key={mark.number}
                    className={filled ? 'has-opinion' : 'empty-opinion'}
                    strokeWidth={1.5 * markScale}
                  >
                    {mark.kind === 'rectangle' ? (
                      <rect
                        x={Math.min(x, x2)}
                        y={Math.min(y, y2)}
                        width={Math.abs(x2 - x)}
                        height={Math.abs(y2 - y)}
                        fill="transparent"
                        onPointerDown={(event) => begin(event, mark)}
                      />
                    ) : (
                      <>
                        <line
                          x1={x}
                          y1={y}
                          x2={x2}
                          y2={y2}
                          markerEnd={`url(#video-arrow-${snapshot.id})`}
                          onPointerDown={(event) => begin(event, mark)}
                        />
                        <line
                          x1={x}
                          y1={y}
                          x2={x2}
                          y2={y2}
                          stroke="transparent"
                          strokeWidth={14 * markScale}
                          onPointerDown={(event) => begin(event, mark)}
                        />
                      </>
                    )}
                    {selected
                      ? (mark.kind === 'arrow'
                          ? [
                              ['start', x, y],
                              ['end', x2, y2]
                            ]
                          : [
                              ['nw', Math.min(x, x2), Math.min(y, y2)],
                              ['ne', Math.max(x, x2), Math.min(y, y2)],
                              ['sw', Math.min(x, x2), Math.max(y, y2)],
                              ['se', Math.max(x, x2), Math.max(y, y2)]
                            ]
                        ).map(([handle, hx, hy]) => (
                          <circle
                            key={handle}
                            cx={Number(hx)}
                            cy={Number(hy)}
                            r={5 * markScale}
                            className="nc-video-handle"
                            onPointerDown={(event) => begin(event, mark, handle as Drag['handle'])}
                          />
                        ))
                      : null}
                    <g
                      role="button"
                      tabIndex={0}
                      aria-label={`意见 ${mark.number}`}
                      className="nc-video-number"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation()
                        setActive((value) => (value === mark.number ? null : mark.number))
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setActive((value) => (value === mark.number ? null : mark.number))
                        }
                      }}
                    >
                      <circle cx={badge.x} cy={badge.y} r={radius} />
                      <text
                        x={badge.x}
                        y={badge.y}
                        fontSize={12 * markScale}
                        textAnchor="middle"
                        dominantBaseline="central"
                      >
                        {mark.number}
                      </text>
                    </g>
                  </g>
                )
              })}
            </svg>
          ) : null}
          {selected && paused ? (
            <div
              className="nc-video-opinion-popover"
              style={{
                left: selected.x1 > 0.55 ? undefined : `${selected.x1 * 100}%`,
                right: selected.x1 > 0.55 ? `${Math.max(0, (1 - selected.x1) * 100)}%` : undefined,
                top: `${Math.min(65, selected.y1 * 100 + 4)}%`
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="nc-video-opinion-heading">
                {selected.number} · {clock(time)}
              </div>
              <textarea
                key={selected.number}
                autoFocus
                rows={3}
                aria-label={`修改意见 ${selected.number}`}
                placeholder="描述这里要怎么改…"
                value={selected.text}
                disabled={locked}
                onChange={(event) => updateMark(selected.number, { text: event.target.value })}
              />
              <div className="nc-video-opinion-actions">
                <Tooltip title="删除意见">
                  <button
                    type="button"
                    aria-label="删除意见"
                    onClick={() => {
                      update({
                        marks: pending.marks.filter((mark) => mark.number !== selected.number)
                      })
                      setActive(null)
                    }}
                  >
                    <HiOutlineTrash />
                  </button>
                </Tooltip>
                <button
                  type="button"
                  disabled={saving || !selected.text.trim()}
                  onClick={() => void commit(pending)}
                >
                  {pending.added ? '已加入输入框' : '加入输入框'}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="nc-video-text-opinion">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          <HiOutlineChatBubbleLeftEllipsis />
          画面意见{pending.text.trim() ? ' · 已填写' : ''}
          <HiOutlineChevronDown style={{ transform: collapsed ? 'rotate(-90deg)' : undefined }} />
        </button>
        {!collapsed ? (
          <div>
            <textarea
              rows={2}
              aria-label="画面文字意见"
              placeholder="描述这个画面，或这段视频要怎么改…"
              value={pending.text}
              disabled={locked}
              onChange={(event) => update({ text: event.target.value })}
            />
            <button
              type="button"
              disabled={
                saving || (!pending.text.trim() && !pending.marks.some((mark) => mark.text.trim()))
              }
              onClick={() => void commit(pending)}
            >
              {pending.added ? '已加入输入框' : '加入输入框'}
            </button>
          </div>
        ) : null}
      </div>
      <div className="nc-video-transport">
        <button
          type="button"
          aria-label={paused ? '播放' : '暂停'}
          onClick={() => {
            if (video.current) {
              if (video.current.paused) void video.current.play()
              else video.current.pause()
            }
          }}
        >
          {paused ? <HiOutlinePlay /> : <HiOutlinePause />}
        </button>
        <Tooltip title="上一帧">
          <button type="button" aria-label="上一帧" onClick={() => seek(time - 1 / fps)}>
            <HiOutlineChevronLeft />
          </button>
        </Tooltip>
        <Tooltip title="下一帧">
          <button type="button" aria-label="下一帧" onClick={() => seek(time + 1 / fps)}>
            <HiOutlineChevronRight />
          </button>
        </Tooltip>
        <span>
          {clock(time)} / {clock(duration)}
        </span>
        <select
          aria-label="播放速度"
          value={rate}
          onChange={(event) => {
            const value = Number(event.target.value)
            setRate(value)
            if (video.current) video.current.playbackRate = value
          }}
        >
          {[0.5, 1, 1.25, 1.5, 2].map((value) => (
            <option key={value} value={value}>
              {value}×
            </option>
          ))}
        </select>
      </div>
      <div
        ref={timeline}
        className="nc-video-filmstrip"
        role="slider"
        tabIndex={0}
        aria-label="视频时间线"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={time}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault()
            seek(time + (event.key === 'ArrowLeft' ? -1 : 1) / fps)
          }
        }}
        onPointerDown={(event) => {
          seeking.current = true
          event.currentTarget.setPointerCapture(event.pointerId)
          seekPointer(event)
        }}
        onPointerMove={(event) => {
          if (seeking.current) seekPointer(event)
        }}
        onPointerUp={(event) => {
          seeking.current = false
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={() => {
          seeking.current = false
        }}
      >
        {frames.map((frame) => (
          <img key={frame.timeSeconds} src={frame.url} alt="" draggable={false} />
        ))}
        {drafts.map((draft) => (
          <span
            key={draft.id}
            className={`nc-video-timeline-mark ${draft.added ? 'added' : ''}`}
            style={{ left: `${(draft.time / duration) * 100}%` }}
            title={`${clock(draft.time)} ${draft.text || draft.marks.map((mark) => mark.text).join(' ')}`}
          />
        ))}
        <span className="nc-video-playhead" style={{ left: `${(time / duration) * 100}%` }} />
      </div>
      <div className="nc-video-range">
        <label>
          时间段{' '}
          <input
            type="number"
            min={0}
            max={duration}
            step={1 / fps}
            aria-label="时间段开始"
            value={pending.range?.startSeconds ?? ''}
            placeholder="起点"
            onChange={(event) =>
              update({
                range: {
                  startSeconds: Number(event.target.value),
                  endSeconds: pending.range?.endSeconds ?? Math.min(duration, time + 1)
                }
              })
            }
          />
        </label>
        <span>—</span>
        <input
          type="number"
          min={0}
          max={duration}
          step={1 / fps}
          aria-label="时间段结束"
          value={pending.range?.endSeconds ?? ''}
          placeholder="终点"
          onChange={(event) =>
            update({
              range: {
                startSeconds: pending.range?.startSeconds ?? time,
                endSeconds: Number(event.target.value)
              }
            })
          }
        />
        {pending.range ? (
          <button type="button" onClick={() => update({ range: undefined })}>
            清除
          </button>
        ) : null}
      </div>
    </div>
  )
}
