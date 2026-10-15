import fs from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { describe, expect, it, vi } from 'vitest'
import {
  createImageReferenceMessage,
  estimateMessagesForContext,
  projectMessagesForMainModel
} from '../../../../src/main/services/ai/human/memory/multimodal'
import { prepareImagesForMainModel } from '../../../../src/main/services/ai/human/tools/agentControl/readImage'
import { agentControlToolFamily } from '../../../../src/main/services/ai/human/tools/agentControl'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import type { AiRunContext } from '../../../../src/main/services/ai/types'
import { FreeModelCatalogService } from '../../../../src/main/services/llm/FreeModelCatalogService'
import type { FreeModelPublicEntry } from '../../../../src/shared/freeModels'
import type { ChatMessageImageRef } from '../../../../src/shared/types'

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)

const ref = (path: string, sizeBytes = 100): ChatMessageImageRef => ({
  path,
  mimeType: 'image/webp',
  sizeBytes,
  width: 100,
  height: 100
})

const retainedUrls = (content: unknown): string[] =>
  Array.isArray(content)
    ? content.flatMap((block) => {
        if (!block || typeof block !== 'object' || block.type !== 'image_url') return []
        const imageUrl = block.image_url
        if (!imageUrl || typeof imageUrl !== 'object' || !('url' in imageUrl)) return []
        return [String(imageUrl.url)]
      })
    : []

describe('ai unit read_image multimodal projection', () => {
  it.each([
    { label: 'a free model with vision', configId: 'free:unit-vision' },
    { label: 'a free model missing from the catalog', configId: 'free:unit-missing' },
    { label: 'a non-free model', configId: 'unit-custom' }
  ])('still loads images for $label', async ({ configId }) => {
    const visionEntry: FreeModelPublicEntry = {
      id: 'unit-vision',
      configId: 'free:unit-vision',
      providerKind: 'openai-compatible',
      modelName: 'unit-model',
      label: 'Unit vision',
      description: '',
      capabilities: ['text', 'vision'],
      iconUrl: ''
    }
    const catalog = vi
      .spyOn(FreeModelCatalogService.getInstance(), 'listPublicModels')
      .mockReturnValue([visionEntry])
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-image-capability-'))
    try {
      const imagePath = path.join(workspace, 'source.png')
      await fs.writeFile(imagePath, ONE_PIXEL_PNG)
      const ctx = {
        partnerId: 'unit-image-capability',
        getLlmConfig: async () => ({
          id: configId,
          name: 'Unit image capability',
          providerKind: 'openai-compatible',
          model_name: 'unit-model',
          base_url: 'https://example.test/v1',
          api_key: 'not-used'
        })
      } as AiRunContext
      const tools = agentControlToolFamily.buildTools({
        ctx,
        cache: createHumanRuntimeCache(),
        runId: 'unit-image-capability',
        partnerId: ctx.partnerId,
        taskId: 'unit-image-capability'
      })
      const readImage = tools.find((tool) => tool.name === 'read_image')
      if (!readImage) throw new Error('read_image tool is missing')
      const result = await readImage.invoke({ paths: [imagePath] })
      expect(result).toMatchObject({ images: [{ width: 1, height: 1, mimeType: 'image/webp' }] })
      expect(result).not.toHaveProperty('error')
    } finally {
      catalog.mockRestore()
      await fs.rm(workspace, { recursive: true, force: true })
    }
  })

  it('changes the cache path when source bytes change and repairs a corrupt cache entry', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-read-image-change-'))
    const sourcePath = path.join(workspace, 'source.png')
    await fs.writeFile(sourcePath, ONE_PIXEL_PNG)
    const [first] = await prepareImagesForMainModel({
      partnerId: 'partner-read-image',
      paths: [sourcePath]
    })

    const canvas = createCanvas(2, 1)
    canvas.getContext('2d').fillStyle = '#ff0000'
    canvas.getContext('2d').fillRect(0, 0, 2, 1)
    await fs.writeFile(sourcePath, await canvas.encode('png'))
    const [changed] = await prepareImagesForMainModel({
      partnerId: 'partner-read-image',
      paths: [sourcePath]
    })

    expect(changed?.path).not.toBe(first?.path)
    await fs.writeFile(changed!.path, 'broken cache', 'utf8')
    const [repaired] = await prepareImagesForMainModel({
      partnerId: 'partner-read-image',
      paths: [sourcePath]
    })
    expect(repaired).toMatchObject({ path: changed?.path, width: 2, height: 1 })
    expect(repaired!.sizeBytes).toBeGreaterThan('broken cache'.length)
  })

  it('keeps an HTTP image as its original address instead of copying it into runtime', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        'content-type': 'image/png',
        'content-length': String(ONE_PIXEL_PNG.length)
      })
      response.end(ONE_PIXEL_PNG)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('test server address unavailable')
    const url = `http://127.0.0.1:${String(address.port)}/image.png`
    try {
      const [image] = await prepareImagesForMainModel({
        partnerId: 'partner-read-image',
        paths: [url]
      })
      expect(image).toEqual({
        path: url,
        mimeType: 'image/png',
        sizeBytes: ONE_PIXEL_PNG.length,
        width: 1,
        height: 1
      })
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  })

  it('never upscales small images and bounds large images to 640000 pixels', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-read-image-size-'))
    const largeCanvas = createCanvas(1600, 800)
    largeCanvas.getContext('2d').fillRect(0, 0, 1600, 800)
    const largePath = path.join(workspace, 'large.png')
    const smallPath = path.join(workspace, 'small.png')
    await Promise.all([
      fs.writeFile(smallPath, ONE_PIXEL_PNG),
      fs.writeFile(largePath, await largeCanvas.encode('png'))
    ])

    const [small, large] = await prepareImagesForMainModel({
      partnerId: 'partner-read-image',
      paths: [smallPath, largePath]
    })

    expect(small).toMatchObject({ width: 1, height: 1 })
    expect(large!.width * large!.height).toBeLessThanOrEqual(640_000)
    expect(large!.width).toBeGreaterThan(large!.height)
    expect(large!.sizeBytes).toBeLessThanOrEqual(1024 * 1024)
  })

  it('includes visual input in context estimates', () => {
    const textOnly = estimateMessagesForContext([createImageReferenceMessage([])])
    const withImage = estimateMessagesForContext([
      createImageReferenceMessage([
        {
          path: '/tmp/large.webp',
          mimeType: 'image/webp',
          sizeBytes: 100,
          width: 1024,
          height: 1024
        }
      ])
    ])
    expect(withImage - textOnly).toBeGreaterThanOrEqual(1024)
  })

  it('replaces a missing runtime image with a stable text placeholder', async () => {
    const missingPath = path.join(os.tmpdir(), 'ncurator-missing-runtime-image.webp')
    const [projected] = await projectMessagesForMainModel([
      createImageReferenceMessage([ref(missingPath)])
    ])

    expect(JSON.stringify(projected?.content)).toContain('图片运行时文件已不可用')
    expect(retainedUrls(projected?.content)).toHaveLength(0)
  })
})
