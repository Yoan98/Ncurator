import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { mediaBinaries, runMediaProcess } from '../MediaProcess'
import { recipeDuration, type VideoRecipe } from './recipe'

export type RenderCanvas = { width: number; height: number; fps: number }

/** Keep normal cuts and captions in FFmpeg; authored layouts use the scene renderer. */
export const canRenderNatively = (recipe: VideoRecipe): boolean =>
  !recipe.overlays.length &&
  !recipe.layouts.length &&
  recipe.transitions.every((item) => item.type === 'cut') &&
  recipe.clips.every((clip) => !/\.svg$/iu.test(clip.path)) &&
  recipe.captions.every(
    (cue) => !cue.style?.fontFamily || cue.style.fontFamily === 'NcuratorSceneSans'
  )

const color = (value: string): string => {
  const context = createCanvas(1, 1).getContext('2d')
  context.clearRect(0, 0, 1, 1)
  context.fillStyle = value
  context.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
  return `0x${[r, g, b].map((item) => item.toString(16).padStart(2, '0')).join('')}@${a / 255}`
}

export const renderNativeVideo = async (
  recipe: VideoRecipe,
  canvas: RenderCanvas,
  task: string,
  output: string,
  signal?: AbortSignal
): Promise<void> => {
  const inputs: string[] = []
  const filters: string[] = []
  for (const [index, clip] of recipe.clips.entries()) {
    inputs.push(...(clip.still ? ['-loop', '1'] : []), '-i', clip.path)
    const timing = clip.still
      ? `trim=duration=${clip.duration},setpts=PTS-STARTPTS`
      : clip.freeze
        ? `trim=start=${clip.sourceStart},setpts=PTS-STARTPTS,select='eq(n,0)',tpad=stop_mode=clone:stop_duration=${clip.duration},trim=duration=${clip.duration}`
        : `trim=start=${clip.sourceStart}:duration=${clip.duration * clip.rate},setpts=(PTS-STARTPTS)/${clip.rate}`
    const sizing =
      clip.fit === 'cover'
        ? `scale=${canvas.width}:${canvas.height}:force_original_aspect_ratio=increase,crop=${canvas.width}:${canvas.height}`
        : `scale=${canvas.width}:${canvas.height}:force_original_aspect_ratio=decrease,pad=${canvas.width}:${canvas.height}:(ow-iw)/2:(oh-ih)/2:color=black`
    filters.push(`[${index}:v]${timing},${sizing},setsar=1,format=yuv420p[v${index}]`)
  }
  filters.push(
    `${recipe.clips.map((_, index) => `[v${index}]`).join('')}concat=n=${recipe.clips.length}:v=1:a=0,fps=${canvas.fps}[joined]`
  )
  let previous = 'joined'
  if (recipe.captions.length) {
    const font = path.join(app.getAppPath(), 'out/main/scene-sans.otf')
    await fs.copyFile(font, path.join(task, 'font.otf'))
    if (!GlobalFonts.has('NcuratorSceneSans'))
      GlobalFonts.registerFromPath(path.join(task, 'font.otf'), 'NcuratorSceneSans')
    const measure = createCanvas(1, 1).getContext('2d')
    for (const [index, cue] of recipe.captions.entries()) {
      const style = cue.style || {},
        box = style.box || { x: 0.05, y: 0.8, width: 0.9, height: 0.16 }
      const naturalSize =
        ((style.fontSize || Math.max(24, recipe.canvas.height * 0.045)) * canvas.width) /
        recipe.canvas.width
      measure.font = `${naturalSize}px NcuratorSceneSans`
      const widest = Math.max(
        ...cue.text.split('\n').map((line) => measure.measureText(line).width),
        1
      )
      const fontSize = naturalSize * Math.min(1, (canvas.width * box.width) / widest)
      const x =
        style.align === 'left'
          ? `${box.x * canvas.width}`
          : style.align === 'right'
            ? `${(box.x + box.width) * canvas.width}-text_w`
            : `${(box.x + box.width / 2) * canvas.width}-text_w/2`
      const y = `${(box.y + box.height / 2) * canvas.height}-text_h/2`
      const textFile = `caption-${index}.txt`
      await fs.writeFile(path.join(task, textFile), cue.text)
      const settings = [
        `fontfile=font.otf`,
        `textfile=${textFile}`,
        'expansion=none',
        `fontsize=${fontSize}`,
        `fontcolor=${color(style.color || '#fff')}`,
        `x=${x}`,
        `y=${y}`,
        `borderw=${((style.strokeWidth ?? Math.max(1, naturalSize / 16)) * canvas.width) / recipe.canvas.width}`,
        `bordercolor=${color(style.strokeColor || '#111')}`,
        ...(style.backgroundColor
          ? ['box=1', `boxcolor=${color(style.backgroundColor)}`, `boxborderw=${fontSize / 4}`]
          : []),
        `enable='gte(t,${cue.range.startSeconds})*lt(t,${cue.range.endSeconds})'`
      ]
      filters.push(`[${previous}]drawtext=${settings.join(':')}[cue${index}]`)
      previous = `cue${index}`
    }
  }
  const script = path.join(task, 'render.ffscript')
  await fs.writeFile(script, filters.join(';\n'))
  await runMediaProcess(
    mediaBinaries().ffmpeg,
    [
      '-nostdin',
      '-v',
      'error',
      ...inputs,
      '-filter_complex_script',
      script,
      '-map',
      `[${previous}]`,
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-threads',
      '2',
      '-filter_complex_threads',
      '2',
      '-t',
      String(recipeDuration(recipe)),
      '-movflags',
      '+faststart',
      '-y',
      output
    ],
    signal,
    undefined,
    task
  )
}
