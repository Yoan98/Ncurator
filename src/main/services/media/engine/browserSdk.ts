/** Browser-only scene helpers. This module is built as an offline ESM asset. */
export const clamp = (value: number, min = 0, max = 1): number =>
  Math.max(min, Math.min(max, value))
export const lerp = (from: number, to: number, t: number): number => from + (to - from) * t
export const progress = (seconds: number, start: number, end: number): number =>
  end === start ? Number(seconds >= end) : clamp((seconds - start) / (end - start))
export const smooth = (t: number): number => {
  const v = clamp(t)
  return v * v * (3 - 2 * v)
}
export const randomAt = (seed: number, index: number): number => {
  let n = (seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0
  n = Math.imul(n ^ (n >>> 16), 0x21f0aaad)
  n = Math.imul(n ^ (n >>> 15), 0x735a2d97)
  return ((n ^ (n >>> 15)) >>> 0) / 4294967296
}
export const roundedRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius = 8
): void => {
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, radius)
  ctx.fill()
}
export const text = (
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  style: { font?: string; color?: string; align?: CanvasTextAlign } = {}
): void => {
  ctx.save()
  ctx.font = style.font || '24px NcuratorSceneSans, sans-serif'
  ctx.fillStyle = style.color || '#111'
  ctx.textAlign = style.align || 'left'
  ctx.fillText(value, x, y)
  ctx.restore()
}
export const wrapText = (
  ctx: CanvasRenderingContext2D,
  value: string,
  maxWidth: number
): string[] => {
  const result: string[] = []
  for (const paragraph of value.split('\n')) {
    let line = ''
    for (const character of paragraph) {
      if (line && ctx.measureText(line + character).width > maxWidth) {
        result.push(line)
        line = ''
      }
      line += character
    }
    result.push(line)
  }
  return result
}
export const mask = (
  ctx: CanvasRenderingContext2D,
  drawMask: () => void,
  drawContent: () => void
): void => {
  ctx.save()
  ctx.beginPath()
  drawMask()
  ctx.clip()
  drawContent()
  ctx.restore()
}
export const loadImage = async (url: string): Promise<HTMLImageElement> => {
  const image = new Image()
  image.src = url
  await image.decode()
  return image
}
export const loadVideo = (url: string): Promise<HTMLVideoElement> =>
  new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.onloadeddata = () => resolve(video)
    video.onerror = () => reject(new Error(`Cannot load ${url}`))
    video.src = url
    video.load()
  })
export const seekVideo = async (video: HTMLVideoElement, seconds: number): Promise<void> => {
  const target = clamp(seconds, 0, Math.max(0, video.duration - 0.000001))
  if (Math.abs(video.currentTime - target) < 0.000001 && video.readyState >= 2) return
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('Video seek timed out')), 15000)
    const finish = (error?: Error): void => {
      clearTimeout(timeout)
      video.removeEventListener('seeked', done)
      video.removeEventListener('error', failed)
      error ? reject(error) : resolve()
    }
    const done = (): void => finish()
    const failed = (): void => finish(new Error('Video seek failed'))
    video.addEventListener('seeked', done, { once: true })
    video.addEventListener('error', failed, { once: true })
    video.currentTime = target
  })
}
export const mediaFit = (
  sw: number,
  sh: number,
  tw: number,
  th: number,
  mode = 'contain'
): { x: number; y: number; width: number; height: number } => {
  const scale = (mode === 'cover' ? Math.max : Math.min)(tw / sw, th / sh)
  const width = sw * scale
  const height = sh * scale
  return { x: (tw - width) / 2, y: (th - height) / 2, width, height }
}
export const particleMorph = (
  from: { x: number; y: number }[],
  to: { x: number; y: number }[],
  t: number
): { x: number; y: number }[] => {
  if (!from.length || !to.length) return []
  return Array.from({ length: Math.max(from.length, to.length) }, (_, i) => ({
    x: lerp(from[i % from.length].x, to[i % to.length].x, t),
    y: lerp(from[i % from.length].y, to[i % to.length].y, t)
  }))
}
