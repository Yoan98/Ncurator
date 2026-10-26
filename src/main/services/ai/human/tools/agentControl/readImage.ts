import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { ensurePartnerAssetBucket } from '../../../../assets/WorkspaceAssetService'
import { resolveToolPath } from '../terminal/commandPolicy'

export type ReadImageRef = {
  path: string
  mimeType: string
  sizeBytes: number
  width: number
  height: number
}

const CACHE_BUCKET_ID = 'read_image-cache'
const NORMALIZATION_VERSION = 'v1'
const MAX_SOURCE_BYTES = 20 * 1024 * 1024
const MAX_SOURCE_PIXELS = 64_000_000
const MAX_SOURCE_EDGE = 8192
const MAX_REQUEST_PIXELS = 640_000
const MAX_REQUEST_BYTES = 1024 * 1024
const MAX_CONCURRENT_TRANSFORMS = 2
const WEBP_QUALITY_LADDER = [90, 82, 74, 66, 58, 50, 42, 34, 26] as const

let activeTransforms = 0
const transformWaiters: Array<() => void> = []
const inFlightByCachePath = new Map<string, Promise<ReadImageRef>>()

const withTransformSlot = async <T>(run: () => Promise<T>): Promise<T> => {
  if (activeTransforms >= MAX_CONCURRENT_TRANSFORMS) {
    await new Promise<void>((resolve) => transformWaiters.push(resolve))
  }
  activeTransforms += 1
  try {
    return await run()
  } finally {
    activeTransforms -= 1
    transformWaiters.shift()?.()
  }
}

const inferImageMimeType = (bytes: Buffer, header: string | null): string => {
  const declared = header?.split(';')[0]?.trim().toLowerCase()
  if (declared?.startsWith('image/')) return declared
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png'
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg'
  if (bytes.subarray(0, 6).toString('ascii').startsWith('GIF8')) return 'image/gif'
  if (
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image/webp'
  return 'application/octet-stream'
}

const readRemoteImage = async (
  url: string
): Promise<{ bytes: Buffer; mimeType: string; width: number; height: number }> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`Remote image download failed: HTTP ${String(response.status)}`)
  const declaredLength = Number(response.headers.get('content-length') || '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SOURCE_BYTES) {
    throw new Error('The remote image exceeds the 20 MiB size limit')
  }
  if (!response.body) throw new Error('The remote image response has no body')

  const chunks: Buffer[] = []
  let total = 0
  const reader = response.body.getReader()
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      const chunk = Buffer.from(next.value)
      total += chunk.length
      if (total > MAX_SOURCE_BYTES) {
        await reader.cancel()
        throw new Error('The remote image exceeds the 20 MiB size limit')
      }
      chunks.push(chunk)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = Buffer.concat(chunks, total)
  const image = await loadImage(bytes).catch(() => null)
  if (!image) throw new Error('The remote image is unsupported or could not be decoded')
  if (
    image.width <= 0 ||
    image.height <= 0 ||
    image.width > MAX_SOURCE_EDGE ||
    image.height > MAX_SOURCE_EDGE ||
    image.width * image.height > MAX_SOURCE_PIXELS
  ) {
    throw new Error(
      'The remote image exceeds the limit of 8192 pixels per side or 64 million total pixels'
    )
  }
  return {
    bytes,
    mimeType: inferImageMimeType(bytes, response.headers.get('content-type')),
    width: image.width,
    height: image.height
  }
}

const readSourceBytes = async (rawPath: string): Promise<Buffer> => {
  const sourcePath = resolveToolPath(rawPath)
  if (!sourcePath) throw new Error(`The image must use an absolute path or HTTP(S) URL: ${rawPath}`)
  const stats = await fs.stat(sourcePath)
  if (!stats.isFile()) throw new Error(`The image path is not a file: ${sourcePath}`)
  if (stats.size > MAX_SOURCE_BYTES)
    throw new Error(`The image exceeds the 20 MiB size limit: ${sourcePath}`)
  return await fs.readFile(sourcePath)
}

const requestDimensions = (width: number, height: number): { width: number; height: number } => {
  const pixels = width * height
  if (pixels <= MAX_REQUEST_PIXELS) return { width, height }
  const scale = Math.sqrt(MAX_REQUEST_PIXELS / pixels)
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale))
  }
}

const encodeWithinBudget = async (
  sourceBytes: Buffer
): Promise<{
  bytes: Buffer
  width: number
  height: number
}> => {
  const image = await loadImage(sourceBytes).catch(() => null)
  if (!image) throw new Error('The image is unsupported or could not be decoded')
  if (
    image.width <= 0 ||
    image.height <= 0 ||
    image.width > MAX_SOURCE_EDGE ||
    image.height > MAX_SOURCE_EDGE ||
    image.width * image.height > MAX_SOURCE_PIXELS
  ) {
    throw new Error(
      'The image exceeds the limit of 8192 pixels per side or 64 million total pixels'
    )
  }

  let dimensions = requestDimensions(image.width, image.height)
  for (let resizeAttempt = 0; resizeAttempt < 6; resizeAttempt += 1) {
    const canvas = createCanvas(dimensions.width, dimensions.height)
    canvas.getContext('2d').drawImage(image, 0, 0, dimensions.width, dimensions.height)
    let smallest: Buffer | undefined
    for (const quality of WEBP_QUALITY_LADDER) {
      const candidate = await canvas.encode('webp', quality)
      smallest = candidate
      if (candidate.length <= MAX_REQUEST_BYTES) {
        return { bytes: candidate, ...dimensions }
      }
    }
    if (!smallest) throw new Error('Image compression failed')
    const nextScale = Math.min(0.9, Math.sqrt(MAX_REQUEST_BYTES / smallest.length) * 0.95)
    const nextWidth = Math.max(1, Math.floor(dimensions.width * nextScale))
    const nextHeight = Math.max(1, Math.floor(dimensions.height * nextScale))
    if (nextWidth === dimensions.width && nextHeight === dimensions.height) break
    dimensions = { width: nextWidth, height: nextHeight }
  }
  throw new Error('The image could not be compressed to fit the 1 MiB request limit')
}

const readCachedImage = async (cachePath: string): Promise<ReadImageRef | null> => {
  try {
    const [bytes, stats] = await Promise.all([fs.readFile(cachePath), fs.stat(cachePath)])
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_REQUEST_BYTES) return null
    const image = await loadImage(bytes).catch(() => null)
    if (!image || image.width <= 0 || image.height <= 0) return null
    return {
      path: cachePath,
      mimeType: 'image/webp',
      sizeBytes: stats.size,
      width: image.width,
      height: image.height
    }
  } catch {
    return null
  }
}

const materializeCachedImage = async (input: {
  cachePath: string
  sourceBytes: Buffer
}): Promise<ReadImageRef> => {
  const cached = await readCachedImage(input.cachePath)
  if (cached) return cached

  const transformed = await withTransformSlot(
    async () => await encodeWithinBudget(input.sourceBytes)
  )
  try {
    await fs.writeFile(input.cachePath, transformed.bytes, { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const winner = await readCachedImage(input.cachePath)
    if (winner) return winner
    await fs.rm(input.cachePath, { force: true })
    await fs.writeFile(input.cachePath, transformed.bytes, { flag: 'wx' })
  }
  return {
    path: input.cachePath,
    mimeType: 'image/webp',
    sizeBytes: transformed.bytes.length,
    width: transformed.width,
    height: transformed.height
  }
}

export const prepareImagesForMainModel = async (input: {
  partnerId: string
  paths: string[]
}): Promise<ReadImageRef[]> => {
  const cacheDirectory = await ensurePartnerAssetBucket(input.partnerId, CACHE_BUCKET_ID)
  const images: ReadImageRef[] = []

  for (const rawValue of input.paths) {
    const rawPath = rawValue.trim()
    if (/^https?:\/\//i.test(rawPath)) {
      const remote = await readRemoteImage(rawPath)
      images.push({
        path: rawPath,
        mimeType: remote.mimeType,
        sizeBytes: remote.bytes.length,
        width: remote.width,
        height: remote.height
      })
      continue
    }
    const sourceBytes = await readSourceBytes(rawPath)
    if (sourceBytes.length === 0) throw new Error(`The image is empty: ${rawPath}`)
    const sourceHash = createHash('sha256').update(sourceBytes).digest('hex')
    const cachePath = path.join(cacheDirectory, `${sourceHash}-${NORMALIZATION_VERSION}.webp`)
    let pending = inFlightByCachePath.get(cachePath)
    if (!pending) {
      pending = materializeCachedImage({ cachePath, sourceBytes })
      inFlightByCachePath.set(cachePath, pending)
      void pending.finally(() => inFlightByCachePath.delete(cachePath)).catch(() => {})
    }
    images.push(await pending)
  }
  return images
}
