import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createImageReferenceMessage,
  projectMessagesForMainModel
} from '../../../../src/main/services/ai/human/memory/multimodal'
import { prepareImagesForMainModel } from '../../../../src/main/services/ai/human/tools/agentControl/readImage'

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)

describe('ai unit read_image multimodal projection', () => {
  it('materializes local images by content hash and keeps remote URLs unchanged', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-read-image-'))
    const sourcePath = path.join(workspace, 'pixel.png')
    await fs.writeFile(sourcePath, ONE_PIXEL_PNG)

    const images = await prepareImagesForMainModel({
      workspaceRootPath: workspace,
      paths: [sourcePath, 'https://example.com/reference.webp']
    })

    expect(images).toHaveLength(2)
    expect(images[0]?.path).toMatch(
      /\.ncurator\/runtime\/assets\/read_image-[^/]+\/[a-f0-9]{64}\.png$/u
    )
    expect(await fs.readFile(images[0]!.path)).toEqual(ONE_PIXEL_PNG)
    expect(images[1]).toEqual({
      path: 'https://example.com/reference.webp',
      mimeType: 'image/webp'
    })
  })

  it('projects multiple image references into one main-model message in order', async () => {
    const message = createImageReferenceMessage([
      { path: 'https://example.com/first.png', mimeType: 'image/png' },
      { path: 'https://example.com/second.jpg', mimeType: 'image/jpeg' }
    ])
    const [projected] = await projectMessagesForMainModel([message])
    const content = projected?.content

    expect(Array.isArray(content)).toBe(true)
    expect(content).toMatchObject([
      { type: 'text' },
      { type: 'image_url', image_url: { url: 'https://example.com/first.png' } },
      { type: 'image_url', image_url: { url: 'https://example.com/second.jpg' } }
    ])
  })

  it('evicts at least five oldest images without mutating persistent references', async () => {
    const images = Array.from({ length: 21 }, (_, index) => ({
      path: `https://example.com/${index}.png`,
      mimeType: 'image/png'
    }))
    const persistent = createImageReferenceMessage(images)
    const [projected] = await projectMessagesForMainModel([persistent])
    const projectedBlocks = Array.isArray(projected?.content) ? projected.content : []
    const retainedUrls = projectedBlocks.flatMap((block) => {
      if (!block || typeof block !== 'object' || block.type !== 'image_url') return []
      const imageUrl = block.image_url
      if (!imageUrl || typeof imageUrl !== 'object' || !('url' in imageUrl)) return []
      return [imageUrl.url]
    })

    expect(JSON.stringify(persistent.content)).toContain('ncurator-image-ref:')
    expect(retainedUrls).not.toContain('https://example.com/0.png')
    expect(retainedUrls).not.toContain('https://example.com/4.png')
    expect(retainedUrls).toContain('https://example.com/5.png')
    expect(JSON.stringify(projected?.content)).toContain('如需再次查看，请调用 read_image')
  })
})
