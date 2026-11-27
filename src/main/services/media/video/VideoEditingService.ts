import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { app } from 'electron'
import { z } from 'zod/v4'
import type { JsonObject } from '../../../../shared/types'
import type { AiRunContext } from '../../ai/types'
import {
  videoClipEditSchema,
  videoVisualEditSchema,
  videoAudioEditSchema,
  videoExportSchema,
  overlaySchema,
  audioSchema
} from '../../ai/human/tools/videoEditing/toolSchemas'
import type {
  ClipEditInput,
  VisualEditInput,
  AudioEditInput,
  ExportInput
} from '../../ai/human/tools/videoEditing/toolSchemas'
import {
  emptyRecipe,
  recipeDuration,
  validateRange,
  remapRecipe,
  parseSubtitles,
  atempo,
  type VideoRecipe,
  type TimelineSpan
} from './recipe'
import { mediaBinaries, runMediaProcess, hashMediaFile } from '../MediaProcess'
import { ElectronDrawingHost } from '../engine/ElectronDrawingHost'
import { getPartnerAssetsRootDir } from '../../assets/WorkspaceAssetService'
import { resolveSafeTextFilePath } from '../../ai/human/tools/textFile/textFileUtils'
import { acquireMediaRender } from '../RenderQueue'
import { canRenderNatively, renderNativeVideo } from './nativeRender'
import { readMediaOrigin } from '../MediaOrigin'
import { getUserDataPath } from '../../../utils/userDataPath'

const probeSchema = z.object({
  streams: z.array(
    z.object({
      codec_type: z.string(),
      width: z.number().optional(),
      height: z.number().optional(),
      r_frame_rate: z.string().optional(),
      sample_rate: z.string().optional()
    })
  ),
  format: z.object({ duration: z.string().optional() }).optional()
})
const probe = async (file: string, signal?: AbortSignal) =>
  probeSchema.parse(
    JSON.parse(
      await runMediaProcess(
        mediaBinaries().ffprobe,
        [
          '-v',
          'error',
          '-show_entries',
          'stream=codec_type,width,height,r_frame_rate,sample_rate:format=duration',
          '-of',
          'json',
          file
        ],
        signal
      )
    )
  )
const image = (file: string): boolean => /\.(png|jpe?g|webp|svg)$/iu.test(file)
const checksum = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
type Origin = { version: 1; outputPath: string; editPath: string; sha256: string }

export const loadVideoRecipe = async (
  input: string,
  signal?: AbortSignal
): Promise<VideoRecipe> => {
  if (!path.isAbsolute(input)) throw new Error('Input path must be absolute')
  const directOrigin = await readMediaOrigin(input)
  if (directOrigin?.outputPath === input && directOrigin.editPath)
    return loadVideoRecipe(directOrigin.editPath, signal)
  if (path.basename(input) === 'edit.json') {
    const recipe = JSON.parse(await fs.readFile(input, 'utf8')) as VideoRecipe
    if (recipe.version !== 1 || !recipe.clips?.length || !recipe.canvas)
      throw new Error('Invalid video edit recipe')
    return recipe
  }
  const root = path.join(path.dirname(input), '.ncurator-media')
  const origins = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  const inputHash = origins.length ? await hashMediaFile(input, signal) : null
  for (const entry of origins) {
    if (!entry.isDirectory()) continue
    const origin = await fs
      .readFile(path.join(root, entry.name, 'origin.json'), 'utf8')
      .then((value) => JSON.parse(value) as Partial<Origin>)
      .catch(() => undefined)
    if (origin?.editPath && origin.sha256 === inputHash)
      return loadVideoRecipe(origin.editPath, signal)
  }
  const info = await probe(input, signal)
  const stream = info.streams.find((item) => item.codec_type === 'video')
  const duration = Number(info.format?.duration)
  if (!stream?.width || !stream.height || !Number.isFinite(duration) || duration <= 0)
    throw new Error('Input must be a decodable video with a duration')
  const recipe = emptyRecipe({
    width: stream.width,
    height: stream.height,
    fps: stream.r_frame_rate && stream.r_frame_rate !== '0/0' ? stream.r_frame_rate : '30'
  })
  recipe.clips.push({
    id: randomUUID(),
    path: input,
    sourceStart: 0,
    duration,
    rate: 1,
    preservePitch: true,
    includeAudio: true,
    fit: 'contain'
  })
  return recipe
}

const compose = async (
  args: Extract<ClipEditInput, { operation: 'compose' }>,
  signal?: AbortSignal
): Promise<VideoRecipe> => {
  let canvas = args.canvas
  const clips: VideoRecipe['clips'] = []
  for (const item of args.clips) {
    if (!path.isAbsolute(item.path)) throw new Error('Clip path must be absolute')
    const info = await probe(item.path, signal)
    const stream = info.streams.find((s) => s.codec_type === 'video')
    if (!stream?.width || !stream.height) throw new Error(`No visual stream: ${item.path}`)
    const still = image(item.path)
    if (!canvas && !still)
      canvas = {
        width: stream.width,
        height: stream.height,
        fps: stream.r_frame_rate && stream.r_frame_rate !== '0/0' ? stream.r_frame_rate : '30'
      }
    const sourceDuration = Number(info.format?.duration)
    const range = item.sourceRange || { startSeconds: 0, endSeconds: sourceDuration }
    if (!still) validateRange(range, sourceDuration)
    if (still && !item.durationSeconds) throw new Error('Images require durationSeconds')
    if (still && item.sourceRange) throw new Error('Images do not accept sourceRange')
    clips.push({
      id: randomUUID(),
      path: item.path,
      sourceStart: still ? 0 : range.startSeconds,
      duration: still ? item.durationSeconds! : range.endSeconds - range.startSeconds,
      rate: 1,
      preservePitch: true,
      includeAudio: item.includeAudio ?? true,
      fit: item.fit || 'contain',
      still
    })
  }
  if (!canvas) throw new Error('An images-only composition requires canvas')
  return { ...emptyRecipe(canvas), clips }
}

const editClips = (
  recipe: VideoRecipe,
  args: Exclude<ClipEditInput, { operation: 'compose' }>
): VideoRecipe => {
  const duration = recipeDuration(recipe)
  let spans: TimelineSpan[] = []
  if (args.operation === 'cut') {
    const ranges = [...args.ranges].sort((a, b) => a.startSeconds - b.startSeconds)
    ranges.forEach((range, i) => {
      validateRange(range, duration)
      if (i && range.startSeconds < ranges[i - 1].endSeconds)
        throw new Error('Cut ranges must not overlap')
    })
    if (args.mode === 'keep')
      spans = ranges.map((range) => ({ start: range.startSeconds, end: range.endSeconds, rate: 1 }))
    else {
      let start = 0
      for (const range of ranges) {
        if (range.startSeconds > start) spans.push({ start, end: range.startSeconds, rate: 1 })
        start = range.endSeconds
      }
      if (start < duration) spans.push({ start, end: duration, rate: 1 })
    }
  } else if (args.operation === 'freeze') {
    if (args.atSeconds >= duration) throw new Error('Freeze position is outside video')
    spans = [
      { start: 0, end: args.atSeconds, rate: 1 },
      { start: args.atSeconds, end: args.atSeconds, rate: 1, freezeDuration: args.durationSeconds },
      { start: args.atSeconds, end: duration, rate: 1 }
    ]
  } else {
    validateRange({ startSeconds: args.startSeconds, endSeconds: args.endSeconds }, duration)
    spans = [
      { start: 0, end: args.startSeconds, rate: 1 },
      {
        start: args.startSeconds,
        end: args.endSeconds,
        rate: args.operation === 'speed' ? args.rate : 1
      }
    ]
    if (args.operation === 'repeat')
      for (let i = 0; i < (args.count ?? 1); i++)
        spans.push({
          start: args.startSeconds,
          end: args.endSeconds,
          rate: 1,
          audio: args.includeAudio ?? false
        })
    spans.push({ start: args.endSeconds, end: duration, rate: 1 })
  }
  spans = spans.filter((span) => span.end > span.start || span.freezeDuration !== undefined)
  if (!spans.length) throw new Error('An edit cannot remove the entire video')
  const next = remapRecipe(recipe, spans)
  if (args.operation === 'speed') {
    let t = 0
    for (const clip of next.clips) {
      if (
        t >= args.startSeconds - 0.000001 &&
        t < args.startSeconds + (args.endSeconds - args.startSeconds) / args.rate - 0.000001
      ) {
        clip.preservePitch = args.preservePitch ?? true
        if (args.mute) clip.includeAudio = false
      }
      t += clip.duration
    }
  }
  return next
}

const updateObjects = <T extends { id: string }>(
  items: T[],
  edits: ({ id: string } & Partial<T>)[]
): void => {
  for (const edit of edits) {
    const matches = items.filter((item) => item.id === edit.id)
    if (!matches.length) throw new Error(`Unknown object: ${edit.id}`)
    for (const item of matches) Object.assign(item, edit)
  }
}
const removeObjects = <T extends { id: string }>(items: T[], ids: string[]): T[] => {
  for (const id of ids)
    if (!items.some((item) => item.id === id)) throw new Error(`Unknown object: ${id}`)
  return items.filter((item) => !ids.includes(item.id))
}

const editVisual = async (recipe: VideoRecipe, args: VisualEditInput): Promise<string[]> => {
  const duration = recipeDuration(recipe)
  const ids: string[] = []
  if (args.operation === 'captions') {
    if (args.action === 'add')
      for (const entry of args.entries ||
        parseSubtitles(await fs.readFile(args.subtitlePath!, 'utf8'))) {
        validateRange(entry.range, duration)
        const id = randomUUID()
        recipe.captions.push({ ...entry, id, style: args.style })
        ids.push(id)
      }
    else if (args.action === 'update') {
      for (const edit of args.edits) if (edit.range) validateRange(edit.range, duration)
      for (const edit of args.edits) {
        const matches = recipe.captions.filter((cue) => cue.id === edit.id)
        if (!matches.length) throw new Error(`Unknown object: ${edit.id}`)
        for (const cue of matches)
          Object.assign(cue, {
            ...edit,
            style: edit.style ? { ...cue.style, ...edit.style } : cue.style
          })
      }
    } else recipe.captions = removeObjects(recipe.captions, args.ids)
  } else if (args.operation === 'overlay') {
    if (args.action === 'add') {
      validateRange(args.range, duration)
      const id = randomUUID()
      recipe.overlays.push({ ...overlaySchema.parse(args), id })
      ids.push(id)
    } else if (args.action === 'update') {
      if (args.changes.range) validateRange(args.changes.range, duration)
      updateObjects(recipe.overlays, [{ id: args.id, ...args.changes }])
    } else recipe.overlays = removeObjects(recipe.overlays, [args.id])
  } else if (args.operation === 'layout') {
    if (args.range) validateRange(args.range, duration)
    if (
      args.keyframes?.some(
        (key, i) =>
          key.timeSeconds > duration ||
          (i > 0 && key.timeSeconds <= args.keyframes![i - 1].timeSeconds)
      )
    )
      throw new Error('Layout keyframes must increase within video duration')
    recipe.layouts.push(args)
  } else {
    let start = 0
    const boundaries = recipe.clips.slice(0, -1).map((clip) => (start += clip.duration))
    if (!boundaries.some((value) => Math.abs(value - args.atSeconds) < 0.000001))
      throw new Error('Transition must be at a clip boundary')
    if (args.type !== 'cut' && !args.durationSeconds)
      throw new Error('Transition durationSeconds is required')
    recipe.transitions = recipe.transitions.filter((item) => item.atSeconds !== args.atSeconds)
    recipe.transitions.push(args)
  }
  return ids
}

const editAudio = (recipe: VideoRecipe, args: AudioEditInput): string[] => {
  if (args.action === 'remove') {
    recipe.audio = removeObjects(recipe.audio, [args.id])
    return []
  }
  let id: string
  if (args.action === 'add') {
    id = randomUUID()
    recipe.audio.push({ ...audioSchema.parse(args), id })
  } else {
    id = args.id
    updateObjects(recipe.audio, [{ id, ...args.changes }])
    for (const track of recipe.audio.filter((item) => item.id === id))
      if (track.automation) {
        if (args.changes.range) track.automation = undefined
        else {
          if (args.changes.fadeInSeconds !== undefined || args.changes.fadeOutSeconds !== undefined)
            track.automation.fade = undefined
          if (args.changes.envelope !== undefined) track.automation.envelope = undefined
        }
      }
  }
  for (const item of recipe.audio.filter((track) => track.id === id)) {
    validateRange(item.range, recipeDuration(recipe))
    const length = item.range.endSeconds - item.range.startSeconds
    if (!item.automation?.fade && (item.fadeInSeconds || 0) + (item.fadeOutSeconds || 0) > length)
      throw new Error('Audio fades exceed track duration')
    if (
      item.envelope?.some(
        (point, i) =>
          point.atSeconds > (item.automation?.envelope ? Infinity : length) ||
          (i > 0 && point.atSeconds <= item.envelope![i - 1].atSeconds)
      )
    )
      throw new Error('Envelope times must increase within the track')
    if (item.sync) {
      const [a, b] = item.sync.anchors
      item.rate = b ? (b.sourceSeconds - a.sourceSeconds) / (b.videoSeconds - a.videoSeconds) : 1
      if (!Number.isFinite(item.rate) || item.rate <= 0)
        throw new Error('Sync anchors must increase')
      item.sourceStartSeconds =
        a.sourceSeconds - (a.videoSeconds - item.range.startSeconds) * item.rate
      if (item.sourceStartSeconds < 0) throw new Error('Sync anchors map before audio start')
    }
  }
  return args.action === 'add' ? [id] : []
}

export const executeVideoEdit = async (
  ctx: AiRunContext,
  kind: 'clip' | 'visual' | 'audio' | 'export',
  raw: JsonObject
): Promise<{ editPath: string; createdIds?: string[] }> => {
  const args =
    kind === 'clip'
      ? videoClipEditSchema.parse(raw)
      : kind === 'visual'
        ? videoVisualEditSchema.parse(raw)
        : kind === 'audio'
          ? videoAudioEditSchema.parse(raw)
          : videoExportSchema.parse(raw)
  let recipe: VideoRecipe
  let createdIds: string[] = []
  if (kind === 'clip' && 'operation' in args && args.operation === 'compose') {
    recipe = await compose(args, ctx.abortSignal)
    createdIds = recipe.clips.map((clip) => clip.id)
  } else {
    if (!('inputPath' in args)) throw new Error('inputPath is required')
    recipe = await loadVideoRecipe(args.inputPath, ctx.abortSignal)
    if (kind === 'clip')
      recipe = editClips(recipe, args as Exclude<ClipEditInput, { operation: 'compose' }>)
    else if (kind === 'visual') createdIds = await editVisual(recipe, args as VisualEditInput)
    else if (kind === 'audio') createdIds = editAudio(recipe, args as AudioEditInput)
  }
  const exportArgs = kind === 'export' ? (args as ExportInput) : undefined
  const editPath = await publishVideo(ctx, recipe, args.outputPath, exportArgs)
  return { editPath, ...(createdIds.length ? { createdIds } : {}) }
}

const publishVideo = async (
  ctx: AiRunContext,
  recipe: VideoRecipe,
  outputPath: string,
  options?: ExportInput
): Promise<string> => {
  if (!path.isAbsolute(outputPath) || !/\.(mp4|webm)$/iu.test(outputPath))
    throw new Error('Video output must be an absolute .mp4 or .webm path')
  const output = await resolveSafeTextFilePath({ sourcePath: outputPath, allowMissing: true })
  if (
    await fs.access(output).then(
      () => true,
      () => false
    )
  )
    throw new Error('目标文件已存在，请使用新版本路径')
  const assetId = randomUUID()
  const task = path.join(getPartnerAssetsRootDir(ctx.partnerId), `video-${assetId}`)
  const saved = path.join(path.dirname(output), '.ncurator-media', assetId)
  const editPath = path.join(saved, 'edit.json')
  const source = path.join(task, 'source')
  await fs.mkdir(source, { recursive: true })
  const duration = recipeDuration(recipe)
  const size = options?.size || recipe.canvas
  const scale = options && options.quality !== 'preview' ? 1 : Math.min(1, 720 / size.height)
  const canvas = {
    width: Math.max(2, Math.round((size.width * scale) / 2) * 2),
    height: Math.max(2, Math.round((size.height * scale) / 2) * 2),
    fps: Number(
      (options?.fps || recipe.canvas.fps).split('/').reduce((a, b) => String(Number(a) / Number(b)))
    )
  }
  const resources: Record<string, string> = {}
  const keys = new Map<string, string>()
  const resource = (file: string): string => {
    if (!path.isAbsolute(file)) throw new Error('Media resource must be an absolute path')
    if (!keys.has(file)) {
      const key = `media${keys.size}`
      keys.set(file, key)
      resources[key] = file
    }
    return keys.get(file)!
  }
  const renderRecipe = structuredClone(recipe)
  renderRecipe.clips.forEach((clip) => {
    clip.path = resource(clip.path)
  })
  for (const overlay of renderRecipe.overlays)
    if (overlay.content.kind === 'media') overlay.content.path = resource(overlay.content.path)
  const scene = `import {createVideoScene} from './video-scene.mjs';\nconst scene=createVideoScene(${JSON.stringify(renderRecipe)});\nexport const initialize=scene.initialize,renderAt=scene.renderAt,dispose=scene.dispose;\n`
  await fs.writeFile(path.join(source, 'scene.mjs'), scene)
  await fs.copyFile(
    path.join(app.getAppPath(), 'out', 'main', 'video-scene.mjs'),
    path.join(source, 'video-scene.mjs')
  )
  await fs.writeFile(
    path.join(source, 'scene.json'),
    JSON.stringify(
      { entry: 'scene.mjs', canvas, durationSeconds: duration, resources, seed: 1 },
      null,
      2
    )
  )
  await fs.writeFile(
    path.join(task, 'task.json'),
    JSON.stringify({ status: 'rendering', outputPath: output }, null, 2)
  )
  const silent = path.join(task, 'silent.mp4')
  const rendered = path.join(task, `output.part${path.extname(output)}`)
  const release = await acquireMediaRender(ctx.abortSignal)
  const host = new ElectronDrawingHost()
  let published = false
  try {
    const files = [
      ...new Set([
        ...recipe.clips.map((clip) => clip.path),
        ...recipe.audio.map((track) => track.path),
        ...recipe.overlays.flatMap((overlay) =>
          overlay.content.kind === 'media' ? [overlay.content.path] : []
        )
      ])
    ].sort()
    const identities = await Promise.all(
      files.map(async (file) => {
        const info = await fs.stat(file)
        return [file, info.size, info.mtimeMs, info.ctimeMs]
      })
    )
    const key = checksum(
      Buffer.from(
        JSON.stringify({
          engine: 1,
          appVersion: app.getVersion(),
          recipe,
          canvas,
          extension: path.extname(output),
          identities
        })
      )
    )
    const cache = path.join(
      getUserDataPath(),
      'preview-cache',
      'video',
      `edit-${key}${path.extname(output)}`
    )
    const cached = await fs.stat(cache).then(
      (info) => info.isFile() && info.size > 0,
      () => false
    )
    if (cached) {
      await fs.copyFile(cache, rendered)
      await fs.utimes(cache, new Date(), new Date())
    } else {
      if (canRenderNatively(recipe))
        await renderNativeVideo(recipe, canvas, task, silent, ctx.abortSignal)
      else {
        const environment = { ...process.env, ...(await host.open()), ELECTRON_RUN_AS_NODE: '1' }
        await runMediaProcess(
          process.execPath,
          [
            path.join(app.getAppPath(), 'out', 'main', 'drawingCli.js'),
            'render',
            '--scene',
            path.join(source, 'scene.json'),
            '--out',
            silent
          ],
          ctx.abortSignal,
          environment
        )
      }
      await mixAudio(recipe, silent, rendered, ctx.abortSignal)
      ctx.checkCancelled()
      await fs.mkdir(path.dirname(cache), { recursive: true })
      const temporaryCache = `${cache}.${randomUUID()}.partial`
      try {
        await fs.copyFile(rendered, temporaryCache)
        await fs.rename(temporaryCache, cache)
      } finally {
        await fs.rm(temporaryCache, { force: true })
      }
    }
    ctx.checkCancelled()
    await probe(rendered, ctx.abortSignal)
    await fs.mkdir(saved, { recursive: true })
    await fs.cp(source, path.join(saved, 'source'), { recursive: true })
    await fs.writeFile(editPath, JSON.stringify(recipe, null, 2), { flag: 'wx' })
    const bytes = await fs.readFile(rendered)
    await fs.writeFile(
      path.join(saved, 'origin.json'),
      JSON.stringify(
        { version: 1, outputPath: output, editPath, sha256: checksum(bytes) },
        null,
        2
      ),
      { flag: 'wx' }
    )
    published = true
    await ctx.writeFileChange({
      sourcePath: output,
      buffer: bytes,
      capability: 'video',
      created: true,
      mediaOrigin: { editPath }
    })
    await fs.rm(task, { recursive: true, force: true }).catch(() => {})
    return editPath
  } catch (error) {
    if (published) await fs.rm(saved, { recursive: true, force: true })
    await fs.writeFile(
      path.join(task, 'task.json'),
      JSON.stringify(
        {
          status: ctx.abortSignal?.aborted ? 'cancelled' : 'failed',
          outputPath: output,
          error: error instanceof Error ? error.message : String(error)
        },
        null,
        2
      )
    )
    throw error
  } finally {
    host.close()
    release()
  }
}

const mixAudio = async (
  recipe: VideoRecipe,
  silent: string,
  output: string,
  signal?: AbortSignal
): Promise<void> => {
  const duration = recipeDuration(recipe)
  const inputs = ['-i', silent]
  const filters = [`anullsrc=r=48000:cl=stereo,atrim=duration=${duration}[silence]`]
  const labels = ['[silence]']
  const tracks: {
    path: string
    start: number
    end: number
    source: number
    rate: number
    gain: number
    fadeIn: number
    fadeOut: number
    loop: boolean
    preservePitch?: boolean
    automation?: VideoRecipe['audio'][number]['automation']
    envelope?: { atSeconds: number; gainDb: number }[]
  }[] = []
  let cursor = 0
  for (const clip of recipe.clips) {
    if (clip.includeAudio && !clip.freeze && !clip.still)
      tracks.push({
        path: clip.path,
        start: cursor,
        end: cursor + clip.duration,
        source: clip.sourceStart,
        rate: clip.rate,
        gain: 0,
        fadeIn: 0,
        fadeOut: 0,
        loop: false,
        preservePitch: clip.preservePitch
      })
    cursor += clip.duration
  }
  for (const audio of recipe.audio)
    tracks.push({
      path: audio.path,
      start: audio.range.startSeconds,
      end: audio.range.endSeconds,
      source: audio.sourceStartSeconds || 0,
      rate: audio.rate || 1,
      gain: audio.gainDb || 0,
      fadeIn: audio.fadeInSeconds || 0,
      fadeOut: audio.fadeOutSeconds || 0,
      loop: audio.loop || false,
      envelope: audio.envelope,
      automation: audio.automation
    })
  for (const overlay of recipe.overlays)
    if (overlay.includeAudio && overlay.content.kind === 'media')
      tracks.push({
        path: overlay.content.path,
        start: overlay.range.startSeconds,
        end: overlay.range.endSeconds,
        source: (overlay.content.sourceRange?.startSeconds || 0) + (overlay.sourceOffset || 0),
        rate: overlay.rate || 1,
        gain: 0,
        fadeIn: 0,
        fadeOut: 0,
        loop: false
      })
  for (const track of tracks) {
    const info = await probe(track.path, signal)
    if (!info.streams.some((stream) => stream.codec_type === 'audio')) continue
    const index = labels.length
    const length = track.end - track.start
    inputs.push(...(track.loop ? ['-stream_loop', '-1'] : []), '-i', track.path)
    const rate =
      track.preservePitch === false
        ? `asetrate=48000*${track.rate},aresample=48000`
        : atempo(track.rate)
    const chain = [
      `[${index}:a]aresample=48000`,
      `atrim=start=${track.source}:duration=${length * track.rate}`,
      'asetpts=PTS-STARTPTS',
      rate,
      `volume=${track.gain}dB`,
      ...(track.fadeIn && !track.automation?.fade ? [`afade=t=in:st=0:d=${track.fadeIn}`] : []),
      ...(track.fadeOut && !track.automation?.fade
        ? [`afade=t=out:st=${Math.max(0, length - track.fadeOut)}:d=${track.fadeOut}`]
        : [])
    ]
    if (track.automation?.fade) {
      const shape = track.automation.fade,
        clock = `(${shape.offset}+t*${shape.rate})`
      const fadeIn = track.fadeIn ? `min(1,max(0,${clock}/${track.fadeIn}))` : '1'
      const fadeOut = track.fadeOut
        ? `min(1,max(0,(${shape.duration}-${clock})/${track.fadeOut}))`
        : '1'
      chain.push(`volume='${fadeIn}*${fadeOut}':eval=frame`)
    }
    if (track.envelope?.length) {
      const shape = track.automation?.envelope,
        clock = shape ? `(${shape.offset}+t*${shape.rate})` : 't'
      const points = track.envelope
      let expression = String(points[points.length - 1].gainDb)
      for (let i = points.length - 2; i >= 0; i--) {
        const a = points[i],
          b = points[i + 1]
        expression = `if(lt(${clock},${b.atSeconds}),${a.gainDb}+(${b.gainDb - a.gainDb})*(${clock}-${a.atSeconds})/${b.atSeconds - a.atSeconds},${expression})`
      }
      expression = `if(lt(${clock},${points[0].atSeconds}),${points[0].gainDb},${expression})`
      chain.push(`volume='pow(10,(${expression})/20)':eval=frame`)
    }
    chain.push(`adelay=${Math.round(track.start * 1000)}:all=1[a${index}]`)
    filters.push(chain.join(','))
    labels.push(`[a${index}]`)
  }
  filters.push(
    `${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest,atrim=duration=${duration}[audio]`
  )
  await runMediaProcess(
    mediaBinaries().ffmpeg,
    [
      '-nostdin',
      '-v',
      'error',
      ...inputs,
      '-filter_complex',
      filters.join(';'),
      '-map',
      '0:v:0',
      '-map',
      '[audio]',
      ...(path.extname(output) === '.webm'
        ? ['-c:v', 'libvpx-vp9', '-c:a', 'libopus']
        : ['-c:v', 'copy', '-c:a', 'aac', '-movflags', '+faststart']),
      '-t',
      String(duration),
      '-threads',
      '2',
      '-y',
      output
    ],
    signal
  )
}
