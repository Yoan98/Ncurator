import { randomUUID, createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import {
  mkdir,
  stat,
  rename,
  rm,
  readdir,
  utimes,
  copyFile,
  writeFile,
  readFile
} from 'node:fs/promises'
import path from 'node:path'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { z } from 'zod'
import {
  isVideoPreviewSource,
  type VideoPreviewSnapshot,
  type VideoPreviewFrame
} from '../../../shared/preview'
import { PreviewResourceService } from './PreviewResourceService'
import { runMediaProcess, hashMediaFile } from '../media/MediaProcess'
import { readMediaOrigin } from '../media/MediaOrigin'
import { getPartnerAssetsRootDir } from '../assets/WorkspaceAssetService'

const execFileAsync = promisify(execFile)
const probeSchema = z.object({
  streams: z.array(
    z.object({
      codec_type: z.string(),
      codec_name: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      r_frame_rate: z.string().optional()
    })
  ),
  format: z.object({ duration: z.string().optional() }).optional()
})
type VideoInfo = {
  video: string
  audio?: string
  width?: number
  height?: number
  duration: number
  fps?: number
}
type ConversionJob = { status: 'converting' | 'ready' | 'failed'; progress: number; output: string }
type Entry = {
  snapshot: VideoPreviewSnapshot
  source: string
  identity: string
  info?: VideoInfo
  grants: string[]
  job?: ConversionJob
  output?: string
  remote: boolean
}
type Deps = {
  resources: PreviewResourceService
  cacheDirectory: string
  ffmpegPath: string
  ffprobePath: string
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
}
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const codecs: Record<string, string> = {
  h264: 'avc1.640028',
  hevc: 'hvc1.1.6.L120.B0',
  vp8: 'vp8',
  vp9: 'vp09.00.10.08',
  aac: 'mp4a.40.2',
  mp3: 'mp3',
  opus: 'opus',
  vorbis: 'vorbis'
}
const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska'
}

/** Direct playback is attempted first. Only an unplayable source starts a shared conversion. */
export class VideoPreviewService {
  private readonly entries = new Map<string, Entry>()
  private readonly jobs = new Map<string, ConversionJob>()
  private readonly children = new Set<ChildProcess>()
  private readonly downloads = new Set<AbortController>()
  private readonly frozenVersions = new Map<
    string,
    Promise<{ version: string; versionPath: string }>
  >()
  private queue = Promise.resolve()
  private disposed = false

  constructor(private readonly deps: Deps) {}

  async open(source: string): Promise<VideoPreviewSnapshot> {
    if (!isVideoPreviewSource(source)) throw new Error('Unsupported video format')
    const remote = /^https:\/\//iu.test(source)
    if (!remote && !path.isAbsolute(source))
      throw new Error('Video source must be an absolute path or HTTPS URL')
    const id = randomUUID()
    let identity: string
    let info: VideoInfo | undefined
    if (remote) {
      const response = await this.fetch(source, {
        method: 'HEAD',
        signal: AbortSignal.timeout(15000)
      }).catch(() => null)
      const validator =
        response?.ok && (response.headers.get('etag') || response.headers.get('last-modified'))
      identity = validator
        ? `${source}:${validator}:${response.headers.get('content-length')}`
        : `${source}:${id}`
    } else {
      const file = await stat(source)
      if (!file.isFile()) throw new Error('Video source is unavailable')
      identity = `${source}:${file.size}:${file.mtimeMs}:${file.ctimeMs}`
      info = await this.probe(source)
    }
    if (this.disposed) throw new Error('Video preview closed')
    const mimeType = MIME[path.extname(remote ? new URL(source).pathname : source).toLowerCase()]
    const grant = remote ? { url: source, id: '' } : this.deps.resources.grantFile(source, mimeType)
    const origin = remote ? undefined : await readMediaOrigin(source)
    const snapshot: VideoPreviewSnapshot = {
      originalPath: origin?.originalPath,
      id,
      url: grant.url,
      status: 'ready',
      mimeType,
      converted: false,
      codecs: info
        ? [codecs[info.video], info.audio ? codecs[info.audio] : undefined]
            .filter(Boolean)
            .join(',')
        : undefined,
      width: info?.width,
      height: info?.height,
      duration: info?.duration,
      version: digest(identity),
      fps: info?.fps
    }
    const entry: Entry = {
      snapshot,
      source,
      identity,
      info,
      grants: grant.id ? [grant.id] : [],
      remote
    }
    this.entries.set(id, entry)
    for (const mode of ['transcode', 'remux']) {
      const output = this.outputPath(entry.identity, mode)
      if (await this.exists(output)) {
        this.useOutput(entry, output)
        break
      }
    }
    return { ...entry.snapshot }
  }

  get(id: string): VideoPreviewSnapshot {
    const entry = this.requireEntry(id)
    if (
      entry.job?.status === 'ready' &&
      (entry.output !== entry.job.output || entry.snapshot.status !== 'ready')
    )
      this.useOutput(entry, entry.job.output)
    if (entry.job?.status === 'failed')
      entry.snapshot = { ...entry.snapshot, status: 'failed', error: 'conversion_failed' }
    if (entry.job?.status === 'converting') entry.snapshot.progress = entry.job.progress
    return { ...entry.snapshot }
  }

  convert(id: string, forceTranscode = false): VideoPreviewSnapshot {
    const entry = this.requireEntry(id)
    if (entry.job?.status === 'converting') return this.get(id)
    const remux =
      !forceTranscode &&
      entry.info?.video === 'h264' &&
      (!entry.info.audio || ['aac', 'mp3'].includes(entry.info.audio))
    const mode = remux ? 'remux' : 'transcode'
    const output = this.outputPath(entry.identity, mode)
    let job = this.jobs.get(output)
    if (!job || job.status === 'failed') {
      job = { status: 'converting', progress: 0, output }
      this.jobs.set(output, job)
      const currentJob = job
      this.queue = this.queue.then(async () => {
        if (this.disposed) {
          currentJob.status = 'failed'
          return
        }
        try {
          await this.convertSource(entry, currentJob, remux, forceTranscode)
          currentJob.status = 'ready'
          currentJob.progress = 100
        } catch (error) {
          console.error('[VIDEO-PREVIEW] conversion failed:', error)
          currentJob.status = 'failed'
        } finally {
          this.jobs.delete(output)
        }
      })
    }
    entry.job = job
    entry.snapshot = {
      ...entry.snapshot,
      status: 'converting',
      progress: job.progress,
      error: undefined
    }
    return this.get(id)
  }

  release(id: string): void {
    const entry = this.entries.get(id)
    entry?.grants.forEach((grant) => this.deps.resources.release(grant))
    this.entries.delete(id)
  }

  async frames(id: string): Promise<VideoPreviewFrame[]> {
    const entry = this.requireEntry(id)
    if (entry.remote || !entry.info?.duration) return []
    await mkdir(this.deps.cacheDirectory, { recursive: true })
    const frames: VideoPreviewFrame[] = []
    for (let i = 0; i < 12; i++) {
      if (!this.entries.has(id)) break
      const lastFrame = Math.max(0, entry.info.duration - 1 / (entry.info.fps || 30))
      const timeSeconds = Math.min((entry.info.duration * i) / 12, lastFrame)
      const file = path.join(this.deps.cacheDirectory, `${digest(entry.identity)}.thumb-${i}.jpg`)
      if (!(await this.exists(file)))
        await runMediaProcess(this.deps.ffmpegPath, [
          '-nostdin',
          '-v',
          'error',
          '-ss',
          String(timeSeconds),
          '-i',
          entry.source,
          '-frames:v',
          '1',
          '-vf',
          'scale=160:-2',
          '-y',
          file
        ])
      if (!this.entries.has(id)) break
      if (!(await this.exists(file))) throw new Error('无法提取视频缩略图')
      const grant = this.deps.resources.grantFile(file, 'image/jpeg')
      entry.grants.push(grant.id)
      frames.push({ timeSeconds, url: grant.url })
    }
    return frames
  }

  async freezeVersion(
    id: string,
    partnerId: string
  ): Promise<{ version: string; versionPath: string }> {
    const key = `${partnerId}:${id}`
    const pending = this.frozenVersions.get(key)
    if (pending) return pending
    const task = this.copyVersion(id, partnerId)
    this.frozenVersions.set(key, task)
    try {
      return await task
    } finally {
      this.frozenVersions.delete(key)
    }
  }

  private async copyVersion(
    id: string,
    partnerId: string
  ): Promise<{ version: string; versionPath: string }> {
    const entry = this.requireEntry(id)
    if (entry.remote) throw new Error('远程视频请先保存到本地再编辑')
    const assets = getPartnerAssetsRootDir(partnerId)
    if (
      entry.source.startsWith(assets + path.sep) &&
      /^video-reference-[a-f0-9]{64}$/u.test(path.basename(path.dirname(entry.source)))
    )
      return {
        version: path.basename(path.dirname(entry.source)).slice('video-reference-'.length),
        versionPath: entry.source
      }
    const current = await stat(entry.source)
    const identity = `${entry.source}:${current.size}:${current.mtimeMs}:${current.ctimeMs}`
    if (identity !== entry.identity) throw new Error('视频文件已经变化，请重新打开后添加意见')
    const version = digest(identity),
      root = path.join(getPartnerAssetsRootDir(partnerId), `video-reference-${version}`)
    const versionPath = path.join(root, `video${path.extname(entry.source)}`)
    if (!(await this.exists(versionPath))) {
      await mkdir(root, { recursive: true })
      const temporary = path.join(root, `${randomUUID()}.part`)
      try {
        await copyFile(entry.source, temporary)
        const after = await stat(entry.source)
        if (
          after.size !== current.size ||
          after.mtimeMs !== current.mtimeMs ||
          after.ctimeMs !== current.ctimeMs
        )
          throw new Error('视频复制时发生变化，请重新打开')
        const sourceOrigin = await this.findEditOrigin(entry.source)
        const originTemp = path.join(root, `${randomUUID()}.json`)
        await writeFile(
          originTemp,
          JSON.stringify({ version: 1, outputPath: versionPath, ...sourceOrigin })
        )
        await rename(originTemp, path.join(root, 'origin.json'))
        await rename(temporary, versionPath)
      } finally {
        await rm(temporary, { force: true })
      }
    }
    return { version, versionPath }
  }

  private async findEditOrigin(
    source: string
  ): Promise<{ editPath?: string; sourcePath?: string; sha256?: string }> {
    const readOrigin = async (file: string) =>
      readFile(file, 'utf8')
        .then(
          (text) =>
            JSON.parse(text) as {
              outputPath?: string
              editPath?: string
              sourcePath?: string
              sha256?: string
            }
        )
        .catch(() => undefined)
    const hash = await hashMediaFile(source)
    const direct = await readMediaOrigin(source)
    if (direct?.outputPath === source && direct.sha256 === hash)
      return { editPath: direct.editPath, sourcePath: direct.sourcePath, sha256: direct.sha256 }
    const root = path.join(path.dirname(source), '.ncurator-media')
    for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory()) continue
      const origin = await readOrigin(path.join(root, entry.name, 'origin.json'))
      if (origin?.sha256 === hash)
        return { editPath: origin.editPath, sourcePath: origin.sourcePath, sha256: origin.sha256 }
    }
    return {}
  }

  dispose(): void {
    this.disposed = true
    this.downloads.forEach((download) => download.abort())
    this.children.forEach((child) => child.kill())
    for (const id of this.entries.keys()) this.release(id)
  }

  /** Cache is reconstructible and limited to one GiB, excluding files in active use. */
  async pruneCache(): Promise<void> {
    await mkdir(this.deps.cacheDirectory, { recursive: true })
    const active = new Set([...this.entries.values()].map((entry) => entry.output).filter(Boolean))
    const files = await Promise.all(
      (await readdir(this.deps.cacheDirectory)).map(async (name) => {
        const file = path.join(this.deps.cacheDirectory, name)
        return { file, info: await stat(file) }
      })
    )
    let size = files.reduce((sum, item) => sum + item.info.size, 0)
    for (const { file, info } of files.sort((a, b) => a.info.mtimeMs - b.info.mtimeMs)) {
      if (
        active.has(file) ||
        [...this.jobs.values()].some(
          (job) => job.status === 'converting' && file.startsWith(job.output)
        )
      )
        continue
      if (
        size <= 1024 ** 3 &&
        Date.now() - info.mtimeMs < 30 * 86400000 &&
        !file.endsWith('.partial.mp4') &&
        !file.endsWith('.download')
      )
        continue
      await rm(file, { force: true })
      size -= info.size
    }
  }

  private requireEntry(id: string): Entry {
    const entry = this.entries.get(id)
    if (!entry) throw new Error('Video preview is closed')
    return entry
  }

  private outputPath(identity: string, mode: string): string {
    return path.join(this.deps.cacheDirectory, `${digest(`v1:${identity}`)}.${mode}.mp4`)
  }

  private async exists(file: string): Promise<boolean> {
    return stat(file).then(
      (info) => info.isFile() && info.size > 0,
      () => false
    )
  }

  private useOutput(entry: Entry, output: string): void {
    const grant = this.deps.resources.grantFile(output, 'video/mp4')
    entry.grants.push(grant.id)
    entry.output = output
    entry.snapshot = {
      ...entry.snapshot,
      url: grant.url,
      mimeType: 'video/mp4',
      codecs: undefined,
      status: 'ready',
      converted: true,
      progress: undefined,
      error: undefined
    }
    void utimes(output, new Date(), new Date()).catch(() => {})
  }

  private fetch(source: string, init: RequestInit): Promise<Response> {
    return (this.deps.fetch || globalThis.fetch)(source, init)
  }

  private async probe(file: string): Promise<VideoInfo> {
    const task = execFileAsync(
      this.deps.ffprobePath,
      [
        '-v',
        'error',
        '-protocol_whitelist',
        'file,pipe',
        '-show_entries',
        'stream=codec_type,codec_name,width,height,r_frame_rate:format=duration',
        '-of',
        'json',
        file
      ],
      { timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true }
    )
    this.children.add(task.child)
    const { stdout } = await task.finally(() => this.children.delete(task.child))
    const parsed = probeSchema.parse(JSON.parse(stdout))
    const video = parsed.streams.find((stream) => stream.codec_type === 'video')
    const audio = parsed.streams.find((stream) => stream.codec_type === 'audio')
    if (!video?.codec_name) throw new Error('No video stream')
    return {
      video: video.codec_name,
      audio: audio?.codec_name,
      width: video.width,
      height: video.height,
      duration: Number(parsed.format?.duration) || 0,
      fps: video.r_frame_rate
        ? video.r_frame_rate
            .split('/')
            .map(Number)
            .reduce((a, b) => a / b)
        : 30
    }
  }

  private async convertSource(
    entry: Entry,
    job: ConversionJob,
    remux: boolean,
    forceRebuild: boolean
  ): Promise<void> {
    await mkdir(this.deps.cacheDirectory, { recursive: true })
    const temporary = `${job.output}.partial.mp4`
    const download = `${job.output}.download`
    try {
      if (!forceRebuild && (await this.exists(job.output))) return
      let source = entry.source
      if (entry.remote) {
        const controller = new AbortController()
        this.downloads.add(controller)
        try {
          const response = await this.fetch(source, {
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(300000)])
          })
          if (!response.ok || !response.body) throw new Error('Video download failed')
          await pipeline(
            Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>),
            createWriteStream(download)
          )
          source = download
          entry.info = await this.probe(source)
        } finally {
          this.downloads.delete(controller)
        }
      }
      if (this.disposed) throw new Error('Video preview closed')
      const encoding = remux
        ? ['-c', 'copy']
        : [
            '-c:v',
            'libx264',
            '-preset',
            'fast',
            '-crf',
            '23',
            '-pix_fmt',
            'yuv420p',
            '-vf',
            'scale=max(2\\,trunc(iw/2)*2):max(2\\,trunc(ih/2)*2)',
            '-threads',
            '2',
            '-c:a',
            'aac',
            '-b:a',
            '160k'
          ]
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          this.deps.ffmpegPath,
          [
            '-nostdin',
            '-y',
            '-v',
            'error',
            '-protocol_whitelist',
            'file,pipe',
            '-i',
            source,
            '-map',
            '0:v:0',
            '-map',
            '0:a:0?',
            ...encoding,
            '-movflags',
            '+faststart',
            '-progress',
            'pipe:1',
            '-nostats',
            temporary
          ],
          { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
        )
        this.children.add(child)
        let stderr = ''
        let progress = ''
        child.stdout?.on('data', (data: Buffer) => {
          progress += data.toString()
          const lines = progress.split('\n')
          progress = lines.pop() || ''
          for (const line of lines) {
            if (!line.startsWith('out_time_us=') || !entry.info?.duration) continue
            job.progress = Math.min(
              99,
              Math.max(0, (Number(line.slice(12)) / 1000000 / entry.info.duration) * 100)
            )
          }
        })
        child.stderr?.on('data', (data: Buffer) => {
          stderr = (stderr + data.toString()).slice(-4000)
        })
        child.once('error', reject)
        child.once('close', (code) => {
          this.children.delete(child)
          if (code === 0) resolve()
          else reject(new Error(`FFmpeg exited ${code}: ${stderr}`))
        })
      })
      if (!(await this.exists(temporary))) throw new Error('Empty video conversion')
      await rename(temporary, job.output)
    } finally {
      await Promise.all([rm(temporary, { force: true }), rm(download, { force: true })])
    }
  }
}
