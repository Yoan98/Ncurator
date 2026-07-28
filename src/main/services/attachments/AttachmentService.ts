import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import type { ChatAttachment } from '../../../shared/types'
import {
  SUPPORTED_ATTACHMENT_FILE_EXTENSIONS,
  SUPPORTED_ATTACHMENT_IMAGE_EXTENSIONS
} from '../../../shared/attachmentFormats'
import { ensureWorkspaceAssetBucket } from '../assets/WorkspaceAssetService'

const SUPPORTED_IMAGE_EXTENSIONS = new Set<string>(SUPPORTED_ATTACHMENT_IMAGE_EXTENSIONS)
const SUPPORTED_FILE_EXTENSIONS = new Set<string>(SUPPORTED_ATTACHMENT_FILE_EXTENSIONS)

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

const isSupportedAttachment = (input: {
  filePath?: string
  name?: string
  mimeType?: string
  kind?: ChatAttachment['kind']
}): boolean => {
  const mimeType = normalizeMimeType(input.mimeType)
  const ext = normalizeExt(
    input.filePath ? path.extname(input.filePath) : path.extname(input.name || '')
  )
  if (input.kind === 'image' || isImageMime(mimeType) || SUPPORTED_IMAGE_EXTENSIONS.has(ext)) {
    return true
  }
  return SUPPORTED_FILE_EXTENSIONS.has(ext)
}

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
    kind?: ChatAttachment['kind']
    mimeType?: string
    displayName?: string
  }): ChatAttachment {
    const resolved = path.resolve(String(input.filePath || '').trim())
    const mimeType = inferMimeType(resolved, input.mimeType)
    const size = fs.existsSync(resolved) ? fs.statSync(resolved).size : undefined
    return {
      id: uuidv4(),
      kind: input.kind || resolveAttachmentKind({ filePath: resolved, mimeType }),
      name: String(input.displayName || path.basename(resolved)).trim() || path.basename(resolved),
      path: resolved,
      mimeType,
      size,
      status: 'ready'
    }
  }

  public isSupportedFile(input: {
    filePath?: string
    name?: string
    mimeType?: string
    kind?: ChatAttachment['kind']
  }): boolean {
    return isSupportedAttachment(input)
  }

  public async saveAttachment(input: {
    workspaceRootPath: string
    assetBucketId: string
    name: string
    bytes: Uint8Array
    mimeType?: string
    kind?: ChatAttachment['kind']
  }): Promise<ChatAttachment> {
    if (!input.bytes.byteLength) {
      throw new Error('附件内容为空')
    }
    if (
      !this.isSupportedFile({
        name: input.name,
        mimeType: input.mimeType,
        kind: input.kind
      })
    ) {
      throw new Error('暂不支持该文件格式')
    }

    const dirPath = await ensureWorkspaceAssetBucket(input.workspaceRootPath, input.assetBucketId)
    const targetPath = await resolveUniqueTargetPath(dirPath, input.name)
    await fs.promises.writeFile(targetPath, Buffer.from(input.bytes))
    return this.createAttachmentFromPath({
      filePath: targetPath,
      kind: input.kind,
      mimeType: input.mimeType,
      displayName: path.basename(input.name)
    })
  }

  public async importAttachmentFromPath(input: {
    workspaceRootPath: string
    assetBucketId: string
    sourcePath: string
    kind?: ChatAttachment['kind']
    mimeType?: string
  }): Promise<ChatAttachment> {
    const sourcePath = path.resolve(String(input.sourcePath || '').trim())
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      throw new Error('附件文件不存在')
    }
    const displayName = path.basename(sourcePath)
    if (
      !this.isSupportedFile({
        filePath: sourcePath,
        name: displayName,
        mimeType: input.mimeType,
        kind: input.kind
      })
    ) {
      throw new Error('暂不支持该文件格式')
    }

    const dirPath = await ensureWorkspaceAssetBucket(input.workspaceRootPath, input.assetBucketId)
    const targetPath = await resolveUniqueTargetPath(dirPath, displayName)
    await fs.promises.copyFile(sourcePath, targetPath)
    return this.createAttachmentFromPath({
      filePath: targetPath,
      kind: input.kind,
      mimeType: input.mimeType,
      displayName
    })
  }

  public async getFileSize(filePath: string): Promise<number> {
    return (await fs.promises.stat(path.resolve(filePath))).size
  }
}
