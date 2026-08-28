import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { ensureWorkspaceAssetBucket } from '../../../../assets/WorkspaceAssetService'
import { resolveToolPath } from '../terminal/commandPolicy'

export type ReadImageRef = {
  path: string
  mimeType: string
  sizeBytes?: number
  width?: number
  height?: number
}

const MAX_DIRECT_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_IMAGE_EDGE = 4096

const sniffImage = (bytes: Buffer): { mimeType: string; extension: string } | null => {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return { mimeType: 'image/png', extension: 'png' }
  }
  if (bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) {
    return { mimeType: 'image/jpeg', extension: 'jpg' }
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mimeType: 'image/webp', extension: 'webp' }
  }
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))) {
    return { mimeType: 'image/gif', extension: 'gif' }
  }
  return null
}

const inferRemoteMime = (url: string): string => {
  const pathname = (() => {
    try {
      return new URL(url).pathname.toLowerCase()
    } catch {
      return ''
    }
  })()
  if (pathname.endsWith('.png')) return 'image/png'
  if (pathname.endsWith('.webp')) return 'image/webp'
  if (pathname.endsWith('.gif')) return 'image/gif'
  return 'image/jpeg'
}

const writeImmutable = async (filePath: string, bytes: Buffer): Promise<void> => {
  try {
    await fs.writeFile(filePath, bytes, { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

const normalizeRaster = async (
  bytes: Buffer
): Promise<{ bytes: Buffer; width: number; height: number }> => {
  const image = await loadImage(bytes)
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.width, image.height))
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const canvas = createCanvas(width, height)
  canvas.getContext('2d').drawImage(image, 0, 0, width, height)
  return { bytes: canvas.toBuffer('image/png'), width, height }
}

export const prepareImagesForMainModel = async (input: {
  workspaceRootPath: string
  paths: string[]
}): Promise<ReadImageRef[]> => {
  const bucket = await ensureWorkspaceAssetBucket(
    input.workspaceRootPath,
    `read_image-${randomUUID()}`
  )
  const images: ReadImageRef[] = []

  for (const rawValue of input.paths) {
    const rawPath = rawValue.trim()
    if (/^https?:\/\//i.test(rawPath)) {
      images.push({ path: rawPath, mimeType: inferRemoteMime(rawPath) })
      continue
    }

    const sourcePath = resolveToolPath(rawPath)
    if (!sourcePath) throw new Error(`图片必须是绝对路径或 HTTP(S) 地址: ${rawPath}`)
    const stats = await fs.stat(sourcePath)
    if (!stats.isFile()) throw new Error(`图片路径不是文件: ${sourcePath}`)
    const sourceBytes = await fs.readFile(sourcePath)
    const detected = sniffImage(sourceBytes)
    let outputBytes = sourceBytes
    let mimeType = detected?.mimeType
    let extension = detected?.extension
    let width: number | undefined
    let height: number | undefined

    const decoded = await loadImage(sourceBytes).catch(() => null)
    if (!decoded) throw new Error(`不支持或无法解码图片: ${sourcePath}`)
    width = decoded.width
    height = decoded.height
    if (
      !detected ||
      sourceBytes.length > MAX_DIRECT_IMAGE_BYTES ||
      Math.max(width, height) > MAX_IMAGE_EDGE
    ) {
      const normalized = await normalizeRaster(sourceBytes)
      outputBytes = Buffer.from(normalized.bytes)
      mimeType = 'image/png'
      extension = 'png'
      width = normalized.width
      height = normalized.height
    }

    const hash = createHash('sha256').update(outputBytes).digest('hex')
    const targetPath = path.join(bucket, `${hash}.${extension}`)
    await writeImmutable(targetPath, outputBytes)
    images.push({
      path: targetPath,
      mimeType: mimeType!,
      sizeBytes: outputBytes.length,
      width,
      height
    })
  }
  return images
}
