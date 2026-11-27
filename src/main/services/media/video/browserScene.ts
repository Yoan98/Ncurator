import { loadImage, loadVideo, seekVideo, mediaFit, lerp, clamp } from '../engine/browserSdk'
import type { VideoRecipe } from './recipe'
import type { Box, TextStyle } from '../../ai/human/tools/videoEditing/toolSchemas'

type SceneContext = {
  container: HTMLElement
  canvas: { width: number; height: number; fps: number }
  resources: Record<string, string>
}
type Media = HTMLImageElement | HTMLVideoElement
const whole: Box = { x: 0, y: 0, width: 1, height: 1 }

export const createVideoScene = (
  recipe: VideoRecipe
): {
  initialize: (context: SceneContext) => Promise<void>
  renderAt: (seconds: number) => Promise<void>
  dispose: () => void
} => {
  let canvas: HTMLCanvasElement
  let ctx: CanvasRenderingContext2D
  let resources: Record<string, string>
  const media = new Map<string, Media>()
  const getMedia = async (key: string, still = false): Promise<Media> => {
    if (!media.has(key))
      media.set(key, await (still ? loadImage(resources[key]) : loadVideo(resources[key])))
    return media.get(key)!
  }
  const shape = (box: Box, mask?: { shape: string; radius?: number }): void => {
    const x = box.x * canvas.width,
      y = box.y * canvas.height,
      w = box.width * canvas.width,
      h = box.height * canvas.height
    ctx.beginPath()
    if (mask?.shape === 'circle') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
    else
      ctx.roundRect(
        x,
        y,
        w,
        h,
        mask?.shape === 'rounded-rect' ? mask.radius || Math.min(w, h) * 0.08 : 0
      )
    ctx.clip()
  }
  const paint = async (
    key: string,
    seconds: number,
    still: boolean,
    placement = whole,
    crop = whole,
    fit: 'contain' | 'cover' = 'contain',
    mask?: { shape: string; radius?: number }
  ): Promise<void> => {
    const item = await getMedia(key, still)
    if (item instanceof HTMLVideoElement) await seekVideo(item, seconds)
    const sw = item instanceof HTMLVideoElement ? item.videoWidth : item.naturalWidth
    const sh = item instanceof HTMLVideoElement ? item.videoHeight : item.naturalHeight
    const w = placement.width * canvas.width,
      h = placement.height * canvas.height
    const target = mediaFit(sw * crop.width, sh * crop.height, w, h, fit)
    ctx.save()
    shape(placement, mask)
    ctx.drawImage(
      item,
      sw * crop.x,
      sh * crop.y,
      sw * crop.width,
      sh * crop.height,
      placement.x * canvas.width + target.x,
      placement.y * canvas.height + target.y,
      target.width,
      target.height
    )
    ctx.restore()
  }
  const drawText = (value: string, style: TextStyle = {}, fallback?: Box): void => {
    const box = style.box || fallback || { x: 0.05, y: 0.8, width: 0.9, height: 0.16 }
    const scale = canvas.width / recipe.canvas.width
    const fontSize = (style.fontSize || Math.max(24, recipe.canvas.height * 0.045)) * scale
    ctx.save()
    ctx.font = `${fontSize}px ${style.fontFamily || 'NcuratorSceneSans, sans-serif'}`
    ctx.textBaseline = 'middle'
    ctx.textAlign = style.align || 'center'
    const x =
      (box.x +
        (ctx.textAlign === 'center' ? box.width / 2 : ctx.textAlign === 'right' ? box.width : 0)) *
      canvas.width
    const lines = value.split('\n')
    const lineHeight = fontSize * 1.25
    for (let i = 0; i < lines.length; i++) {
      const y = (box.y + box.height / 2) * canvas.height + (i - (lines.length - 1) / 2) * lineHeight
      const width = Math.min(
        ctx.measureText(lines[i]).width + fontSize * 0.5,
        box.width * canvas.width
      )
      if (style.backgroundColor) {
        ctx.fillStyle = style.backgroundColor
        ctx.fillRect(
          x - (ctx.textAlign === 'center' ? width / 2 : ctx.textAlign === 'right' ? width : 0),
          y - lineHeight / 2,
          width,
          lineHeight
        )
      }
      ctx.lineWidth = (style.strokeWidth ?? Math.max(1, fontSize / 16)) * scale
      ctx.strokeStyle = style.strokeColor || '#111'
      ctx.strokeText(lines[i], x, y, box.width * canvas.width)
      ctx.fillStyle = style.color || '#fff'
      ctx.fillText(lines[i], x, y, box.width * canvas.width)
    }
    ctx.restore()
  }
  const interpolateBox = (a: Box, b: Box, t: number): Box => ({
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    width: lerp(a.width, b.width, t),
    height: lerp(a.height, b.height, t)
  })
  return {
    async initialize(context) {
      resources = context.resources
      canvas = document.createElement('canvas')
      canvas.width = context.canvas.width
      canvas.height = context.canvas.height
      context.container.append(canvas)
      ctx = canvas.getContext('2d')!
    },
    async renderAt(seconds) {
      ctx.globalAlpha = 1
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      let start = 0
      for (const clip of recipe.clips) {
        if (seconds >= start && seconds < start + clip.duration) {
          const layout = recipe.layouts.findLast(
            (item) =>
              !item.range || (seconds >= item.range.startSeconds && seconds < item.range.endSeconds)
          )
          let crop = layout?.crop || whole,
            placement = layout?.placement || whole
          if (layout?.keyframes?.length) {
            const frames = layout.keyframes
            const after = frames.findIndex((key) => key.timeSeconds > seconds)
            const left = frames[Math.max(0, after === -1 ? frames.length - 1 : after - 1)],
              right = frames[after === -1 ? frames.length - 1 : after]
            let t =
              left === right
                ? 0
                : clamp((seconds - left.timeSeconds) / (right.timeSeconds - left.timeSeconds))
            if (layout.easing === 'ease-in') t *= t
            else if (layout.easing === 'ease-out') t = 1 - (1 - t) ** 2
            else if (layout.easing === 'ease-in-out') t = t * t * (3 - 2 * t)
            crop = interpolateBox(left.crop || crop, right.crop || crop, t)
            placement = interpolateBox(left.placement || placement, right.placement || placement, t)
          }
          await paint(
            clip.path,
            clip.sourceStart + (clip.freeze ? 0 : (seconds - start) * clip.rate),
            !!clip.still,
            placement,
            crop,
            layout?.fit || clip.fit,
            layout?.mask
          )
          break
        }
        start += clip.duration
      }
      for (const transition of recipe.transitions) {
        const d = transition.durationSeconds || 0
        if (transition.type === 'fade' && d && Math.abs(seconds - transition.atSeconds) < d / 2) {
          ctx.fillStyle = `rgba(0,0,0,${1 - Math.abs(seconds - transition.atSeconds) / (d / 2)})`
          ctx.fillRect(0, 0, canvas.width, canvas.height)
        }
        if (
          transition.type === 'wipe-left' &&
          d &&
          seconds >= transition.atSeconds &&
          seconds < transition.atSeconds + d
        ) {
          const p = (seconds - transition.atSeconds) / d
          ctx.fillStyle = '#000'
          ctx.fillRect(canvas.width * p, 0, canvas.width * (1 - p), canvas.height)
        }
      }
      for (const overlay of recipe.overlays) {
        if (seconds < overlay.range.startSeconds || seconds >= overlay.range.endSeconds) continue
        ctx.save()
        ctx.globalAlpha = overlay.opacity ?? 1
        if (overlay.content.kind === 'text')
          drawText(overlay.content.text, { ...overlay.content.style, box: overlay.box })
        else
          await paint(
            overlay.content.path,
            (overlay.content.sourceRange?.startSeconds || 0) +
              (overlay.sourceOffset || 0) +
              (overlay.freeze ? 0 : seconds - overlay.range.startSeconds) * (overlay.rate || 1),
            /\.(png|jpe?g|webp|svg)$/iu.test(
              resources[overlay.content.path] || overlay.content.path
            ),
            overlay.box,
            whole,
            overlay.fit,
            overlay.mask
          )
        ctx.restore()
      }
      for (const caption of recipe.captions)
        if (seconds >= caption.range.startSeconds && seconds < caption.range.endSeconds)
          drawText(caption.text, caption.style)
    },
    dispose() {
      for (const item of media.values())
        if (item instanceof HTMLVideoElement) {
          item.pause()
          item.removeAttribute('src')
          item.load()
        }
      media.clear()
      canvas?.remove()
    }
  }
}
