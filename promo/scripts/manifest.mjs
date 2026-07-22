import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { access, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { hyperframesVersion } from './lib.mjs'

const execFileAsync = promisify(execFile)
const toPosix = (value) => value.split(path.sep).join('/')
export const renderSourceNames = [
  'index.html',
  'hyperframes.json',
  'package.json',
  'narration.txt',
  'transcript.json',
  'caption-overrides.json'
]

export const sha256File = async (filePath) => {
  const hash = createHash('sha256')
  hash.update(await readFile(filePath))
  return hash.digest('hex')
}

export const sha256Text = (value) => createHash('sha256').update(value).digest('hex')

export const listFiles = async (rootDir) => {
  const output = []
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(filePath)
      else if (entry.isFile()) output.push(filePath)
    }
  }
  await visit(rootDir)
  return output.sort()
}

const writeJsonAtomic = async (filePath, value) => {
  const tempPath = `${filePath}.tmp`
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`)
  await rename(tempPath, filePath)
}

const assetRole = (relativePath) => {
  if (relativePath === 'assets/audio/narration.wav') return 'narration'
  if (relativePath === 'assets/audio/music.wav') return 'music'
  if (relativePath.startsWith('assets/captured/source/')) return 'capture-source'
  if (relativePath.startsWith('assets/captured/clips/')) return 'capture-clip'
  if (relativePath.startsWith('assets/captured/stills/')) return 'capture-still'
  return 'metadata'
}

const readEpisodeBase = async (episodeDir) => {
  for (const fileName of ['episode.json', 'meta.json']) {
    try {
      return JSON.parse(await readFile(path.join(episodeDir, fileName), 'utf8'))
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  throw new Error(`${episodeDir} 缺少 episode.json 或旧 meta.json`)
}

const readCompositionVideo = async (episodeDir) => {
  const html = await readFile(path.join(episodeDir, 'index.html'), 'utf8')
  const openingTag = html.match(/<div\s+[^>]*data-composition-id=["']main["'][^>]*>/u)?.[0]
  if (!openingTag) throw new Error(`${episodeDir}/index.html 缺少 main composition`)
  const numberAttribute = (name) =>
    Number(openingTag.match(new RegExp(`${name}=["']([\\d.]+)["']`, 'u'))?.[1])
  const video = {
    width: numberAttribute('data-width'),
    height: numberAttribute('data-height'),
    fps: 30,
    duration: numberAttribute('data-duration')
  }
  if (Object.values(video).some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error(`${episodeDir}/index.html 的画布参数不完整`)
  }
  return video
}

export const syncEpisodeManifest = async (episodeDir) => {
  const base = await readEpisodeBase(episodeDir)
  const assetRoot = path.join(episodeDir, 'assets')
  const files = await listFiles(assetRoot)
  const assets = []
  for (const filePath of files) {
    const relativePath = toPosix(path.relative(episodeDir, filePath))
    const fileStat = await stat(filePath)
    assets.push({
      role: assetRole(relativePath),
      path: relativePath,
      size: fileStat.size,
      sha256: await sha256File(filePath)
    })
  }
  const sources = []
  for (const fileName of renderSourceNames) {
    const filePath = path.join(episodeDir, fileName)
    try {
      const fileStat = await stat(filePath)
      sources.push({ path: fileName, size: fileStat.size, sha256: await sha256File(filePath) })
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  const manifest = {
    schemaVersion: 1,
    id: base.id || path.basename(episodeDir),
    name: base.name || path.basename(episodeDir),
    title: base.title || path.basename(episodeDir),
    createdAt: base.createdAt,
    video: await readCompositionVideo(episodeDir),
    tools: { hyperframes: hyperframesVersion, node: '>=22' },
    sources,
    assets
  }
  await writeJsonAtomic(path.join(episodeDir, 'episode.json'), manifest)
  return manifest
}

export const probeVideo = async (filePath) => {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-show_streams',
    '-show_format',
    '-of',
    'json',
    filePath
  ])
  const probe = JSON.parse(stdout)
  const stream = probe.streams?.find((item) => item.codec_type === 'video')
  if (!stream) throw new Error(`无法读取视频流：${filePath}`)
  const [fpsNumerator, fpsDenominator] = String(stream.avg_frame_rate || '0/1')
    .split('/')
    .map(Number)
  return {
    width: Number(stream.width),
    height: Number(stream.height),
    fps: fpsDenominator ? fpsNumerator / fpsDenominator : 0,
    duration: Number(probe.format?.duration),
    codec: stream.codec_name
  }
}

export const syncFinalManifest = async (episodeDir) => {
  const finalPath = path.join(episodeDir, 'renders', 'final.mp4')
  await access(finalPath)
  const episodeText = await readFile(path.join(episodeDir, 'episode.json'), 'utf8')
  const fileStat = await stat(finalPath)
  const manifest = {
    schemaVersion: 1,
    path: 'renders/final.mp4',
    size: fileStat.size,
    sha256: await sha256File(finalPath),
    episodeManifestSha256: sha256Text(episodeText),
    video: await probeVideo(finalPath)
  }
  await writeJsonAtomic(path.join(episodeDir, 'renders', 'final.json'), manifest)
  return manifest
}
