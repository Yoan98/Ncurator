import fs from 'fs'
import os from 'os'
import path from 'path'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import mammoth from 'mammoth'
import pdfParse from 'pdf-parse'
import JSZip from 'jszip'
import { v4 as uuidv4 } from 'uuid'
import type { ChatAttachment, LlmRuntimeConfig } from '../../../shared/types'
import { createChatModel } from '../llm/chatModel'
import { AI_LLM_CALL_TIMEOUT_MS } from '../ai/constants'

const MAX_CONTENT_INFO_CHARS = 16_000
const TEMP_ATTACHMENT_DIR = path.join(os.tmpdir(), 'ncurator-attachments')

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'json', 'csv'])
const DOCUMENT_EXTENSIONS = new Set(['docx', 'pdf', 'ppt', 'pptx'])
const SUPPORTED_FILE_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ...DOCUMENT_EXTENSIONS])

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
}

type RunnableMessage = {
  content: unknown
}

type VisionRunnable = {
  invoke: (
    input: Array<SystemMessage | HumanMessage>,
    config?: { signal?: AbortSignal }
  ) => Promise<RunnableMessage>
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const normalizeExt = (value: string): string =>
  String(value || '')
    .trim()
    .replace(/^\./, '')
    .toLowerCase()

const getExt = (filePath: string): string => normalizeExt(path.extname(filePath))

const inferMimeType = (filePath: string, fallback?: string): string => {
  const ext = getExt(filePath)
  return fallback || MIME_BY_EXTENSION[ext] || 'application/octet-stream'
}

const isImageMime = (mimeType: string): boolean => String(mimeType || '').startsWith('image/')

const clipContentInfo = (value: string): string => {
  const normalized = value
    .split(String.fromCharCode(0))
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
  if (normalized.length <= MAX_CONTENT_INFO_CHARS) return normalized
  return `${normalized.slice(0, MAX_CONTENT_INFO_CHARS)}\n\n[内容过长，已截断]`
}

const extractMessageText = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (!part || typeof part !== 'object') return ''
      const candidate = part as { text?: unknown; content?: unknown }
      return typeof candidate.text === 'string'
        ? candidate.text
        : typeof candidate.content === 'string'
          ? candidate.content
          : ''
    })
    .join('')
}

const ensureTempDir = async (): Promise<void> => {
  await fs.promises.mkdir(TEMP_ATTACHMENT_DIR, { recursive: true })
}

const readXmlTextNodes = (xml: string): string => {
  const pieces: string[] = []
  const regex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(xml))) {
    pieces.push(
      match[1]
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
    )
  }
  return pieces.join('\n')
}

const extractPptxText = async (filePath: string): Promise<string> => {
  const zip = await JSZip.loadAsync(await fs.promises.readFile(filePath))
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
  const slides: string[] = []
  for (const slidePath of slideFiles) {
    const xml = await zip.files[slidePath].async('string')
    const text = readXmlTextNodes(xml).trim()
    if (text) slides.push(text)
  }
  return slides.join('\n\n')
}

const extractLegacyPptText = async (filePath: string): Promise<string> => {
  const buffer = await fs.promises.readFile(filePath)
  const ascii = buffer
    .toString('latin1')
    .replace(/[^\x20-\x7E\n\r\t]+/g, '\n')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length >= 3)
  const utf16 = buffer
    .toString('utf16le')
    .replace(/[^\u4e00-\u9fa5\w\s.,，。:：;；!?！？()（）-]+/g, '\n')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length >= 3)
  return Array.from(new Set([...ascii, ...utf16])).join('\n')
}

export class AttachmentService {
  public createAttachmentFromPath(input: {
    filePath: string
    kind?: ChatAttachment['kind']
    mimeType?: string
  }): ChatAttachment {
    const resolved = path.resolve(String(input.filePath || '').trim())
    const mimeType = inferMimeType(resolved, input.mimeType)
    const size = fs.existsSync(resolved) ? fs.statSync(resolved).size : undefined
    return {
      id: uuidv4(),
      kind: input.kind || (isImageMime(mimeType) ? 'image' : 'file'),
      name: path.basename(resolved),
      path: resolved,
      mimeType,
      size,
      status: 'ready'
    }
  }

  public async saveTempAttachment(input: {
    name: string
    bytes: Uint8Array
    mimeType?: string
    kind?: ChatAttachment['kind']
  }): Promise<ChatAttachment> {
    await ensureTempDir()
    const safeName = path.basename(String(input.name || 'attachment').trim() || 'attachment')
    const targetPath = path.join(TEMP_ATTACHMENT_DIR, `${Date.now()}-${uuidv4()}-${safeName}`)
    await fs.promises.writeFile(targetPath, Buffer.from(input.bytes))
    const attachment = this.createAttachmentFromPath({
      filePath: targetPath,
      kind: input.kind,
      mimeType: input.mimeType
    })
    return {
      ...attachment,
      name: safeName
    }
  }

  public isSupportedFile(filePath: string): boolean {
    return SUPPORTED_FILE_EXTENSIONS.has(getExt(filePath))
  }

  public async getFileSize(filePath: string): Promise<number> {
    return (await fs.promises.stat(path.resolve(filePath))).size
  }

  public async parseFileAttachment(attachment: ChatAttachment): Promise<ChatAttachment> {
    const resolved = path.resolve(attachment.path)
    const ext = getExt(resolved)
    if (!SUPPORTED_FILE_EXTENSIONS.has(ext)) {
      return { ...attachment, status: 'failed', error: '暂不支持该文件格式' }
    }

    try {
      let content = ''
      if (TEXT_EXTENSIONS.has(ext)) {
        content = await fs.promises.readFile(resolved, 'utf8')
      } else if (ext === 'docx') {
        const result = await mammoth.extractRawText({ path: resolved })
        content = result.value
      } else if (ext === 'pdf') {
        const result = await pdfParse(await fs.promises.readFile(resolved))
        content = result.text
      } else if (ext === 'pptx') {
        content = await extractPptxText(resolved)
      } else if (ext === 'ppt') {
        content = await extractLegacyPptText(resolved)
      }

      const contentInfo = clipContentInfo(content)
      if (!contentInfo) {
        return { ...attachment, status: 'failed', error: '文件没有提取到可用内容' }
      }
      return { ...attachment, status: 'ready', contentInfo, error: undefined }
    } catch (error) {
      return { ...attachment, status: 'failed', error: getErrorMessage(error) || '文件解析失败' }
    }
  }

  public async recognizeImageAttachment(input: {
    attachment: ChatAttachment
    config: LlmRuntimeConfig
  }): Promise<ChatAttachment> {
    try {
      const resolved = path.resolve(input.attachment.path)
      const mimeType = inferMimeType(resolved, input.attachment.mimeType)
      const base64 = (await fs.promises.readFile(resolved)).toString('base64')
      const model = createChatModel(input.config, {
        temperature: 0.1,
        streaming: false,
        timeout: AI_LLM_CALL_TIMEOUT_MS
      }) as VisionRunnable
      const result = await model.invoke([
        new SystemMessage(
          '你只负责识别用户选择的图片内容，并输出简洁、客观的内容信息。不要输出与图片无关的说明。'
        ),
        new HumanMessage({
          content: [
            {
              type: 'text',
              text: '请识别这张图片，输出能帮助后续完成用户任务的内容信息。只输出内容信息正文。'
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64}`
              }
            }
          ]
        })
      ])
      const contentInfo = clipContentInfo(extractMessageText(result.content))
      if (!contentInfo) {
        return { ...input.attachment, status: 'failed', error: '当前模型不支持图像识别' }
      }
      return { ...input.attachment, status: 'ready', contentInfo, error: undefined }
    } catch {
      return { ...input.attachment, status: 'failed', error: '当前模型不支持图像识别' }
    }
  }
}
