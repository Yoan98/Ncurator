import fs from 'node:fs/promises'
import path from 'node:path'
import { HumanMessage } from '@langchain/core/messages'
import { createCanvas } from '@napi-rs/canvas'
import { describe, it } from 'vitest'
import {
  createImageReferenceMessage,
  projectMessagesForMainModel
} from '../../../../../src/main/services/ai/human/memory/multimodal'
import type { ChatMessageImageRef } from '../../../../../src/shared/types'
import { createAgentControlToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

type ReadImageResult = {
  message: string
  images: ChatMessageImageRef[]
}

const imageUrls = (message: HumanMessage): string[] =>
  Array.isArray(message.content)
    ? message.content.flatMap((block) => {
        if (!block || typeof block !== 'object' || block.type !== 'image_url') return []
        const imageUrl = block.image_url
        if (!imageUrl || typeof imageUrl !== 'object' || !('url' in imageUrl)) return []
        return [String(imageUrl.url)]
      })
    : []

const imageRef = (pathValue: string, sizeBytes: number): ChatMessageImageRef => ({
  path: pathValue,
  mimeType: 'image/webp',
  sizeBytes,
  width: 100,
  height: 100
})

describe('ai tool agent-control backend', () => {
  it('read-image-multimodal-contract', async () => {
    await runBackendCase({
      caseId: 'read-image-multimodal-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['agent-control'],
      description: '验证 read_image 复用内容缓存，并把多图按顺序投影到同一个主模型消息。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const firstPath = path.join(runtime.workspaceRoot, 'first.png')
        const duplicatePath = path.join(runtime.workspaceRoot, 'duplicate.png')
        const secondPath = path.join(runtime.workspaceRoot, 'second.png')
        const firstCanvas = createCanvas(16, 12)
        firstCanvas.getContext('2d').fillStyle = '#ff0000'
        firstCanvas.getContext('2d').fillRect(0, 0, 16, 12)
        const secondCanvas = createCanvas(8, 20)
        secondCanvas.getContext('2d').fillStyle = '#0066ff'
        secondCanvas.getContext('2d').fillRect(0, 0, 8, 20)
        const firstBytes = await firstCanvas.encode('png')
        await Promise.all([
          fs.writeFile(firstPath, firstBytes),
          fs.writeFile(duplicatePath, firstBytes),
          fs.writeFile(secondPath, await secondCanvas.encode('png'))
        ])

        const harness = createAgentControlToolHarness(runtime)
        const result = await harness.invoke<ReadImageResult>('read_image', {
          paths: [firstPath, duplicatePath, secondPath]
        })
        const persistent = createImageReferenceMessage(result.images)
        const [projected] = await projectMessagesForMainModel([persistent])
        return {
          result,
          persistentContent: JSON.stringify(persistent.content),
          projectedUrls: imageUrls(projected as HumanMessage)
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.result.images.length === 3 &&
            result.result.images[0]?.path === result.result.images[1]?.path &&
            result.result.images[0]?.path !== result.result.images[2]?.path &&
            result.result.images.every((image) =>
              /read_image-cache\/[a-f0-9]{64}-v1\.webp$/u.test(image.path)
            ) &&
            result.projectedUrls.length === 3 &&
            result.projectedUrls.every((url) => url.startsWith('data:image/webp;base64,')) &&
            result.persistentContent.includes('ncurator-image-ref:') &&
            !result.persistentContent.includes(';base64,'),
          {
            name: 'read-image-uses-one-main-model-multimodal-message',
            message: 'read_image 应复用同内容缓存，持久消息不含 Base64，请求消息按原顺序包含全部图片。',
            data: result
          }
        )
      }
    })
  })

  it('multimodal-image-budget-contract', async () => {
    await runBackendCase({
      caseId: 'multimodal-image-budget-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['agent-control'],
      description: '验证图片数量与本地 data URL 体积按稳定批次裁剪，且不修改持久消息。',
      fixtures: [],
      runMode: 'single',
      execute: async () => {
        const countHistory = createImageReferenceMessage(
          Array.from({ length: 601 }, (_, index) =>
            imageRef(`https://example.com/${String(index)}.webp`, 100)
          )
        )
        const byteHistory = createImageReferenceMessage(
          Array.from({ length: 25 }, (_, index) =>
            imageRef(`data:image/webp;base64,AA${String(index)}`, 1024 * 1024)
          )
        )
        const countPersistent = JSON.stringify(countHistory.content)
        const bytePersistent = JSON.stringify(byteHistory.content)
        const [countProjected] = await projectMessagesForMainModel([countHistory])
        const [byteProjected] = await projectMessagesForMainModel([byteHistory])
        return {
          countPersistentUnchanged: JSON.stringify(countHistory.content) === countPersistent,
          bytePersistentUnchanged: JSON.stringify(byteHistory.content) === bytePersistent,
          countUrls: imageUrls(countProjected as HumanMessage),
          countProjectedContent: JSON.stringify(countProjected.content),
          byteUrls: imageUrls(byteProjected as HumanMessage),
          byteProjectedContent: JSON.stringify(byteProjected.content)
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.countPersistentUnchanged &&
            result.bytePersistentUnchanged &&
            result.countUrls.length === 581 &&
            !result.countUrls.includes('https://example.com/19.webp') &&
            result.countUrls.includes('https://example.com/20.webp') &&
            result.countProjectedContent.includes('如需再次查看，请调用 read_image') &&
            !result.byteUrls.includes('data:image/webp;base64,AA10') &&
            result.byteUrls.includes('data:image/webp;base64,AA11') &&
            result.byteProjectedContent.includes('如需再次查看，请调用 read_image'),
          {
            name: 'multimodal-image-budget-evicts-stable-oldest-batches',
            message: '图片预算应一次裁剪足够多的最旧图片，并保持持久历史不变。',
            data: result
          }
        )
      }
    })
  })
})
