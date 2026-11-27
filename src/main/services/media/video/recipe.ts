import { randomUUID } from 'node:crypto'
import type {
  TimeRange,
  TextStyle,
  OverlayFields,
  AudioFields,
  VisualEditInput
} from '../../ai/human/tools/videoEditing/toolSchemas'

export type VideoClip = {
  id: string
  path: string
  sourceStart: number
  duration: number
  rate: number
  includeAudio: boolean
  preservePitch: boolean
  fit: 'contain' | 'cover'
  still?: boolean
  freeze?: boolean
}
export type Caption = { id: string; text: string; range: TimeRange; style?: TextStyle }
export type AudioAutomation = {
  fade?: { offset: number; rate: number; duration: number }
  envelope?: { offset: number; rate: number }
}
export type VideoRecipe = {
  version: 1
  canvas: { width: number; height: number; fps: string }
  clips: VideoClip[]
  captions: Caption[]
  overlays: (OverlayFields & {
    id: string
    sourceOffset?: number
    rate?: number
    freeze?: boolean
  })[]
  audio: (AudioFields & { id: string; rate?: number; automation?: AudioAutomation })[]
  layouts: Extract<VisualEditInput, { operation: 'layout' }>[]
  transitions: Extract<VisualEditInput, { operation: 'transition' }>[]
}
export type TimelineSpan = {
  start: number
  end: number
  rate: number
  audio?: boolean
  freezeDuration?: number
}
export const recipeDuration = (recipe: VideoRecipe): number =>
  recipe.clips.reduce((sum, clip) => sum + clip.duration, 0)
export const emptyRecipe = (canvas: VideoRecipe['canvas']): VideoRecipe => ({
  version: 1,
  canvas,
  clips: [],
  captions: [],
  overlays: [],
  audio: [],
  layouts: [],
  transitions: []
})

export const validateRange = (range: TimeRange, duration: number): void => {
  if (
    !Number.isFinite(range.startSeconds) ||
    !Number.isFinite(range.endSeconds) ||
    range.startSeconds < 0 ||
    range.endSeconds <= range.startSeconds ||
    range.endSeconds > duration + 0.000001
  )
    throw new Error(`Time range must be within [0, ${duration})`)
}

/** Materialize a new timeline entirely from source-backed spans; never use encoded previews. */
export const remapRecipe = (recipe: VideoRecipe, spans: TimelineSpan[]): VideoRecipe => {
  const next: VideoRecipe = {
    ...structuredClone(recipe),
    clips: [],
    captions: [],
    overlays: [],
    audio: [],
    layouts: [],
    transitions: []
  }
  let outputStart = 0
  for (const span of spans) {
    const newDuration = span.freezeDuration ?? (span.end - span.start) / span.rate
    let oldClipStart = 0
    for (const clip of recipe.clips) {
      const lo = Math.max(oldClipStart, span.start)
      const hi = Math.min(oldClipStart + clip.duration, span.end)
      if (
        hi > lo ||
        (span.freezeDuration !== undefined &&
          span.start >= oldClipStart &&
          span.start < oldClipStart + clip.duration)
      ) {
        next.clips.push({
          ...clip,
          id: randomUUID(),
          sourceStart: clip.sourceStart + (lo - oldClipStart) * (clip.freeze ? 0 : clip.rate),
          duration: span.freezeDuration ?? (hi - lo) / span.rate,
          rate: clip.rate * span.rate,
          freeze: span.freezeDuration !== undefined || clip.freeze,
          includeAudio:
            span.freezeDuration !== undefined ? false : (span.audio ?? clip.includeAudio)
        })
        if (span.freezeDuration !== undefined) break
      }
      oldClipStart += clip.duration
    }
    const rangeMap = (range: TimeRange): TimeRange | undefined => {
      if (span.freezeDuration !== undefined)
        return range.startSeconds <= span.start && range.endSeconds > span.start
          ? { startSeconds: outputStart, endSeconds: outputStart + newDuration }
          : undefined
      const lo = Math.max(range.startSeconds, span.start)
      const hi = Math.min(range.endSeconds, span.end)
      return hi > lo
        ? {
            startSeconds: outputStart + (lo - span.start) / span.rate,
            endSeconds: outputStart + (hi - span.start) / span.rate
          }
        : undefined
    }
    for (const caption of recipe.captions) {
      const range = rangeMap(caption.range)
      if (range) next.captions.push({ ...caption, range })
    }
    for (const overlay of recipe.overlays) {
      if (overlay.binding === 'timeline') continue
      const range = rangeMap(overlay.range)
      if (range)
        next.overlays.push({
          ...overlay,
          range,
          includeAudio:
            span.audio === false || span.freezeDuration !== undefined
              ? false
              : overlay.includeAudio,
          freeze: span.freezeDuration !== undefined || overlay.freeze,
          sourceOffset:
            (overlay.sourceOffset || 0) +
            Math.max(0, span.start - overlay.range.startSeconds) * (overlay.rate || 1),
          rate: (overlay.followRate === false ? 1 : span.rate) * (overlay.rate || 1)
        })
    }
    for (const audio of recipe.audio) {
      if (audio.binding !== 'content' || span.audio === false) continue
      const range = rangeMap(audio.range)
      if (range && span.freezeDuration === undefined)
        next.audio.push({
          ...audio,
          range,
          sourceStartSeconds:
            (audio.sourceStartSeconds || 0) +
            Math.max(0, span.start - audio.range.startSeconds) * (audio.rate || 1),
          rate: (audio.followRate === false ? 1 : span.rate) * (audio.rate || 1),
          automation: {
            fade: {
              offset:
                (audio.automation?.fade?.offset || 0) +
                Math.max(0, span.start - audio.range.startSeconds) *
                  (audio.automation?.fade?.rate || 1),
              rate: (audio.automation?.fade?.rate || 1) * span.rate,
              duration:
                audio.automation?.fade?.duration ??
                audio.range.endSeconds - audio.range.startSeconds
            },
            envelope: {
              offset:
                (audio.automation?.envelope?.offset || 0) +
                Math.max(0, span.start - audio.range.startSeconds) *
                  (audio.automation?.envelope?.rate || 1),
              rate: (audio.automation?.envelope?.rate || 1) * span.rate
            }
          }
        })
    }
    for (const layout of recipe.layouts) {
      const range = rangeMap(
        layout.range || { startSeconds: 0, endSeconds: recipeDuration(recipe) }
      )
      if (range)
        next.layouts.push({
          ...(span.freezeDuration !== undefined ? freezeLayout(layout, span.start) : layout),
          range,
          keyframes:
            span.freezeDuration !== undefined
              ? undefined
              : layout.keyframes?.map((key) => ({
                  ...key,
                  timeSeconds: outputStart + (key.timeSeconds - span.start) / span.rate
                }))
        })
    }
    for (const transition of recipe.transitions)
      if (transition.atSeconds > span.start && transition.atSeconds < span.end)
        next.transitions.push({
          ...transition,
          atSeconds: outputStart + (transition.atSeconds - span.start) / span.rate,
          durationSeconds: (transition.durationSeconds || 0) / span.rate
        })
    outputStart += newDuration
  }
  next.overlays.push(
    ...recipe.overlays
      .filter((item) => item.binding === 'timeline')
      .map((item) => structuredClone(item))
  )
  next.audio.push(
    ...recipe.audio
      .filter((item) => item.binding !== 'content')
      .map((item) => structuredClone(item))
  )
  return next
}

export const atempo = (rate: number): string => {
  const factors: number[] = []
  while (rate > 2) {
    factors.push(2)
    rate /= 2
  }
  while (rate < 0.5) {
    factors.push(0.5)
    rate /= 0.5
  }
  factors.push(rate)
  return factors.map((value) => `atempo=${value}`).join(',')
}

export const parseSubtitles = (value: string): { text: string; range: TimeRange }[] => {
  const time = (raw: string): number =>
    raw
      .replace(',', '.')
      .split(':')
      .reduce((total, part) => total * 60 + Number(part), 0)
  const result: { text: string; range: TimeRange }[] = []
  for (const block of value.replaceAll('\r', '').split(/\n\s*\n/u)) {
    const lines = block.split('\n')
    const i = lines.findIndex((line) => line.includes('-->'))
    if (i < 0) continue
    const match = lines[i].match(/([\d:.,]+)\s*-->\s*([\d:.,]+)/u)
    if (!match) throw new Error('Invalid subtitle time')
    const text = lines
      .slice(i + 1)
      .join('\n')
      .trim()
    if (text)
      result.push({ text, range: { startSeconds: time(match[1]), endSeconds: time(match[2]) } })
  }
  if (!result.length) throw new Error('Subtitle file has no cues')
  return result
}

const freezeLayout = (
  layout: VideoRecipe['layouts'][number],
  seconds: number
): VideoRecipe['layouts'][number] => {
  if (!layout.keyframes?.length) return layout
  const frames = layout.keyframes,
    after = frames.findIndex((key) => key.timeSeconds > seconds)
  const left = frames[Math.max(0, after === -1 ? frames.length - 1 : after - 1)],
    right = frames[after === -1 ? frames.length - 1 : after]
  let t =
    left === right
      ? 0
      : Math.max(
          0,
          Math.min(1, (seconds - left.timeSeconds) / (right.timeSeconds - left.timeSeconds))
        )
  if (layout.easing === 'ease-in') t *= t
  else if (layout.easing === 'ease-out') t = 1 - (1 - t) ** 2
  else if (layout.easing === 'ease-in-out') t = t * t * (3 - 2 * t)
  const interpolate = (
    a: { x: number; y: number; width: number; height: number },
    b: typeof a
  ) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    width: a.width + (b.width - a.width) * t,
    height: a.height + (b.height - a.height) * t
  })
  const whole = { x: 0, y: 0, width: 1, height: 1 },
    crop = layout.crop || whole,
    placement = layout.placement || whole
  return {
    ...layout,
    crop: interpolate(left.crop || crop, right.crop || crop),
    placement: interpolate(left.placement || placement, right.placement || placement),
    keyframes: undefined
  }
}
