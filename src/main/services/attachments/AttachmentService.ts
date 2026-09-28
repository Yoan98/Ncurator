import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import type { ChatAttachment } from '../../../shared/types'
import { ensurePartnerAssetBucket } from '../assets/WorkspaceAssetService'

const SUPPORTED_IMAGE_EXTENSIONS = new Set<string>([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'tif',
  'tiff'
])

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  md: 'text/markdown',
  json: 'application/json',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  xltx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  xltm: 'application/vnd.ms-excel.template.macroEnabled.12'
}

const normalizeExt = (value: string): string =>
  String(value || '')
    .trim()
    .replace(/^\./, '')
    .toLowerCase()

const getExt = (filePath: string): string => normalizeExt(path.extname(filePath))

const normalizeMimeType = (value?: string): string | undefined => {
  const mimeType = String(value || '')
    .trim()
    .toLowerCase()
  return mimeType || undefined
}

const inferMimeType = (filePath: string, fallback?: string): string => {
  const normalizedFallback = normalizeMimeType(fallback)
  if (normalizedFallback) return normalizedFallback
  return MIME_BY_EXTENSION[getExt(filePath)] || 'application/octet-stream'
}

const isImageMime = (mimeType?: string): boolean =>
  String(mimeType || '')
    .trim()
    .toLowerCase()
    .startsWith('image/')

const resolveAttachmentKind = (input: {
  filePath: string
  mimeType?: string
}): ChatAttachment['kind'] =>
  isImageMime(input.mimeType) || SUPPORTED_IMAGE_EXTENSIONS.has(getExt(input.filePath))
    ? 'image'
    : 'file'

const splitFileName = (name: string): { stem: string; extWithDot: string } => {
  const safeName = path.basename(String(name || 'attachment').trim() || 'attachment')
  const parsed = path.parse(safeName)
  return {
    stem: parsed.name || 'attachment',
    extWithDot: parsed.ext || ''
  }
}

const resolveUniqueTargetPath = async (dirPath: string, name: string): Promise<string> => {
  const { stem, extWithDot } = splitFileName(name)
  let attempt = 0
  while (true) {
    const suffix = attempt === 0 ? '' : `-${String(attempt)}`
    const targetPath = path.join(dirPath, `${stem}${suffix}${extWithDot}`)
    try {
      await fs.promises.access(targetPath)
      attempt += 1
    } catch {
      return targetPath
    }
  }
}

export class AttachmentService {
  public createAttachmentFromPath(input: {
    filePath: string
    kind?: Exclude<ChatAttachment['kind'], 'directory'>
    mimeType?: string
    displayName?: string
  }): ChatAttachment {
    const resolved = path.resolve(String(input.filePath || '').trim())
    const stats = fs.existsSync(resolved) ? fs.statSync(resolved) : null
    const isDirectory = Boolean(stats?.isDirectory())
    const mimeType = isDirectory ? undefined : inferMimeType(resolved, input.mimeType)
    const size = stats && !isDirectory ? stats.size : undefined
    return {
      id: uuidv4(),
      kind: isDirectory
        ? 'directory'
        : input.kind || resolveAttachmentKind({ filePath: resolved, mimeType }),
      name: String(input.displayName || path.basename(resolved)).trim() || path.basename(resolved),
      path: resolved,
      mimeType,
      size,
      status: 'ready'
    }
  }

  public async createSourceAttachmentFromPath(input: {
    sourcePath: string
    mimeType?: string
  }): Promise<ChatAttachment> {
    const rawSourcePath = String(input.sourcePath || '').trim()
    if (!rawSourcePath) throw new Error('附件路径不存在')
    const sourcePath = path.resolve(rawSourcePath)
    if (!fs.existsSync(sourcePath)) throw new Error('附件路径不存在')
    const stats = await fs.promises.stat(sourcePath)
    if (!stats.isFile() && !stats.isDirectory()) throw new Error('附件必须是文件或目录')
    return this.createAttachmentFromPath({
      filePath: sourcePath,
      mimeType: input.mimeType
    })
  }

  public async saveAttachment(input: {
    partnerId: string
    assetBucketId: string
    name: string
    bytes: Uint8Array
    mimeType?: string
    kind?: Exclude<ChatAttachment['kind'], 'directory'>
  }): Promise<ChatAttachment> {
    if (!input.bytes.byteLength) {
      throw new Error('附件内容为空')
    }

    const dirPath = await ensurePartnerAssetBucket(input.partnerId, input.assetBucketId)
    const targetPath = await resolveUniqueTargetPath(dirPath, input.name)
    await fs.promises.writeFile(targetPath, Buffer.from(input.bytes))
    return this.createAttachmentFromPath({
      filePath: targetPath,
      kind: input.kind,
      mimeType: input.mimeType,
      displayName: path.basename(input.name)
    })
  }

  public async getFileSize(filePath: string): Promise<number> {
    return (await fs.promises.stat(path.resolve(filePath))).size
  }
}
