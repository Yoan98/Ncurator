import fs from 'node:fs/promises'
import { HumanMessage, type BaseMessage } from '@langchain/core/messages'
import type { ChatMessageImageRef } from '../../../../../shared/types'
import { estimateTextTokens } from '../utils/tokenEstimate'

const IMAGE_REF_SCHEME = 'ncurator-image-ref:'
const MAX_RETAINED_IMAGES = 600
const MAX_INLINE_BYTES = 20 * 1024 * 1024
const COUNT_EVICTION_QUANTUM = 20
const BYTE_EVICTION_QUANTUM = 10 * 1024 * 1024

type ImageReferenceBlock = {
  type: 'image_url'
  image_url: {
    url: string
    mime_type: string
    size_bytes: number
    width: number
    height: number
  }
}

const encodeRef = (path: string): string => `${IMAGE_REF_SCHEME}${encodeURIComponent(path)}`
const decodeRef = (url: string): string | null => {
  if (!url.startsWith(IMAGE_REF_SCHEME)) return null
  try {
    return decodeURIComponent(url.slice(IMAGE_REF_SCHEME.length))
  } catch {
    return null
  }
}

const isImageReferenceBlock = (value: unknown): value is ImageReferenceBlock => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const block = value as { type?: unknown; image_url?: unknown }
  if (block.type !== 'image_url' || !block.image_url || typeof block.image_url !== 'object')
    return false
  const image = block.image_url as { url?: unknown; mime_type?: unknown }
  return (
    typeof image.url === 'string' &&
    image.url.startsWith(IMAGE_REF_SCHEME) &&
    typeof image.mime_type === 'string'
  )
}

export const createImageReferenceMessage = (images: ChatMessageImageRef[]): HumanMessage =>
  new HumanMessage({
    content: [
      { type: 'text', text: '以下图片由 read_image 按输入顺序加入，请直接结合图片内容继续处理。' },
      ...images.map(
        (image): ImageReferenceBlock => ({
          type: 'image_url',
          image_url: {
            url: encodeRef(image.path),
            mime_type: image.mimeType,
            size_bytes: image.sizeBytes,
            width: image.width,
            height: image.height
          }
        })
      )
    ]
  })

type Occurrence = {
  messageIndex: number
  blockIndex: number
  path: string
  estimatedInlineBytes: number
}

const estimateInlineBytes = (block: ImageReferenceBlock, path: string): number => {
  if (/^https?:\/\//i.test(path)) return 0
  const base64Bytes = Math.ceil(block.image_url.size_bytes / 3) * 4
  return base64Bytes + `data:${block.image_url.mime_type};base64,`.length
}

const resolveEvictedOccurrences = (occurrences: Occurrence[]): Set<string> => {
  let retainedCount = occurrences.length
  let retainedBytes = occurrences.reduce((sum, item) => sum + item.estimatedInlineBytes, 0)
  if (retainedCount <= MAX_RETAINED_IMAGES && retainedBytes <= MAX_INLINE_BYTES) return new Set()

  const evicted = new Set<string>()
  const countOverage = Math.max(0, retainedCount - MAX_RETAINED_IMAGES)
  const minimumEvictions =
    countOverage > 0
      ? Math.max(
          COUNT_EVICTION_QUANTUM,
          Math.ceil(countOverage / COUNT_EVICTION_QUANTUM) * COUNT_EVICTION_QUANTUM
        )
      : 0
  const byteOverage = Math.max(0, retainedBytes - MAX_INLINE_BYTES)
  const minimumBytesToEvict = byteOverage > 0 ? Math.max(BYTE_EVICTION_QUANTUM, byteOverage) : 0
  let evictedCount = 0
  let evictedBytes = 0
  for (const item of occurrences) {
    if (evictedCount >= minimumEvictions && evictedBytes >= minimumBytesToEvict) break
    evicted.add(`${item.messageIndex}:${item.blockIndex}`)
    retainedCount -= 1
    retainedBytes -= item.estimatedInlineBytes
    evictedCount += 1
    evictedBytes += item.estimatedInlineBytes
  }
  return evicted
}

const toDataUrl = async (path: string, mimeType: string): Promise<string> => {
  if (/^https?:\/\//i.test(path) || /^data:/i.test(path)) return path
  const bytes = await fs.readFile(path)
  return `data:${mimeType};base64,${bytes.toString('base64')}`
}

export const projectMessagesForMainModel = async (
  messages: BaseMessage[]
): Promise<BaseMessage[]> => {
  const occurrences: Occurrence[] = []
  messages.forEach((message, messageIndex) => {
    if (!Array.isArray(message.content)) return
    message.content.forEach((block, blockIndex) => {
      if (!isImageReferenceBlock(block)) return
      const path = decodeRef(block.image_url.url)
      if (!path) return
      occurrences.push({
        messageIndex,
        blockIndex,
        path,
        estimatedInlineBytes: estimateInlineBytes(block, path)
      })
    })
  })
  const evicted = resolveEvictedOccurrences(occurrences)

  return await Promise.all(
    messages.map(async (message, messageIndex) => {
      if (message.getType() !== 'human' || !Array.isArray(message.content)) return message
      const content = await Promise.all(
        message.content.map(async (block, blockIndex) => {
          if (!isImageReferenceBlock(block)) return block
          const path = decodeRef(block.image_url.url)
          if (!path) return block
          if (evicted.has(`${messageIndex}:${blockIndex}`)) {
            return {
              type: 'text' as const,
              text: `[图片已从当前请求上下文移除：${path}。如需再次查看，请调用 read_image。]`
            }
          }
          let dataUrl: string
          try {
            dataUrl = await toDataUrl(path, block.image_url.mime_type)
          } catch {
            return {
              type: 'text' as const,
              text: `[图片运行时文件已不可用：${path}。]`
            }
          }
          return {
            type: 'image_url' as const,
            image_url: {
              url: dataUrl
            }
          }
        })
      )
      return new HumanMessage({ content })
    })
  )
}

export const estimateMessageImageTokens = (messages: BaseMessage[]): number => {
  const occurrences: Occurrence[] = []
  messages.forEach((message, messageIndex) => {
    if (!Array.isArray(message.content)) return
    message.content.forEach((block, blockIndex) => {
      if (!isImageReferenceBlock(block)) return
      const path = decodeRef(block.image_url.url)
      if (!path) return
      occurrences.push({
        messageIndex,
        blockIndex,
        path,
        estimatedInlineBytes: estimateInlineBytes(block, path)
      })
    })
  })
  const evicted = resolveEvictedOccurrences(occurrences)
  let total = 0
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex]!
    if (!Array.isArray(message.content)) continue
    for (let blockIndex = 0; blockIndex < message.content.length; blockIndex += 1) {
      const block = message.content[blockIndex]
      if (!isImageReferenceBlock(block)) continue
      if (evicted.has(`${messageIndex}:${blockIndex}`)) continue
      const width = block.image_url.width
      const height = block.image_url.height
      total += Math.max(256, Math.ceil(width / 512) * Math.ceil(height / 512) * 256)
    }
  }
  return total
}

export const estimateMessagesForContext = (messages: BaseMessage[]): number =>
  estimateTextTokens(
    messages
      .map((message) =>
        typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
      )
      .join('\n')
  ) + estimateMessageImageTokens(messages)
