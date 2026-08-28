import fs from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import {
  createImageReferenceMessage,
  projectMessagesForMainModel
} from '../../../../src/main/services/ai/human/memory/multimodal'
import { prepareImagesForMainModel } from '../../../../src/main/services/ai/human/tools/agentControl/readImage'
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
  it('normalizes once and reuses one content-addressed cache file', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-read-image-'))
    const firstPath = path.join(workspace, 'first.png')
    const secondPath = path.join(workspace, 'second.png')
    await Promise.all([
      fs.writeFile(firstPath, ONE_PIXEL_PNG),
      fs.writeFile(secondPath, ONE_PIXEL_PNG)
    ])

    const [first] = await prepareImagesForMainModel({
      workspaceRootPath: workspace,
      paths: [firstPath]
    })
    const [second] = await prepareImagesForMainModel({
      workspaceRootPath: workspace,
      paths: [secondPath]
    })

    expect(first).toEqual(second)
    expect(first?.path).toMatch(
      /\.ncurator\/runtime\/assets\/read_image-cache\/[a-f0-9]{64}-v1\.webp$/u
    )
    expect(first?.mimeType).toBe('image/webp')
    expect(first?.width).toBe(1)
    expect(first?.height).toBe(1)
    expect(first?.sizeBytes).toBeGreaterThan(0)
  })

  it('changes the cache path when source bytes change and repairs a corrupt cache entry', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-read-image-change-'))
    const sourcePath = path.join(workspace, 'source.png')
    await fs.writeFile(sourcePath, ONE_PIXEL_PNG)
    const [first] = await prepareImagesForMainModel({
      workspaceRootPath: workspace,
      paths: [sourcePath]
    })

    const canvas = createCanvas(2, 1)
    canvas.getContext('2d').fillStyle = '#ff0000'
    canvas.getContext('2d').fillRect(0, 0, 2, 1)
    await fs.writeFile(sourcePath, await canvas.encode('png'))
    const [changed] = await prepareImagesForMainModel({
      workspaceRootPath: workspace,
      paths: [sourcePath]
    })

    expect(changed?.path).not.toBe(first?.path)
    await fs.writeFile(changed!.path, 'broken cache', 'utf8')
    const [repaired] = await prepareImagesForMainModel({
      workspaceRootPath: workspace,
      paths: [sourcePath]
    })
    expect(repaired).toMatchObject({ path: changed?.path, width: 2, height: 1 })
    expect(repaired!.sizeBytes).toBeGreaterThan('broken cache'.length)
  })

  it('keeps an HTTP image as its original address instead of copying it into runtime', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-read-image-remote-'))
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
        workspaceRootPath: workspace,
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
      workspaceRootPath: workspace,
      paths: [smallPath, largePath]
    })

    expect(small).toMatchObject({ width: 1, height: 1 })
    expect(large!.width * large!.height).toBeLessThanOrEqual(640_000)
    expect(large!.width).toBeGreaterThan(large!.height)
    expect(large!.sizeBytes).toBeLessThanOrEqual(1024 * 1024)
  })

  it('projects multiple image references into one main-model message in order', async () => {
    const message = createImageReferenceMessage([
      ref('https://example.com/first.webp'),
      ref('https://example.com/second.webp')
    ])
    const [projected] = await projectMessagesForMainModel([message])

    expect(retainedUrls(projected?.content)).toEqual([
      'https://example.com/first.webp',
      'https://example.com/second.webp'
    ])
  })

  it('evicts oldest images in stable batches of twenty without mutating history', async () => {
    const images = Array.from({ length: 601 }, (_, index) =>
      ref(`https://example.com/${String(index)}.webp`)
    )
    const persistent = createImageReferenceMessage(images)
    const [projected] = await projectMessagesForMainModel([persistent])
    const urls = retainedUrls(projected?.content)

    expect(JSON.stringify(persistent.content)).toContain('ncurator-image-ref:')
    expect(JSON.stringify(persistent.content)).not.toContain(';base64,')
    expect(urls).toHaveLength(581)
    expect(urls).not.toContain('https://example.com/19.webp')
    expect(urls).toContain('https://example.com/20.webp')
  })

  it('evicts at least ten MiB of oldest inline payload when the byte budget is exceeded', async () => {
    const images = Array.from({ length: 25 }, (_, index) =>
      ref(`data:image/webp;base64,AA${String(index)}`, 1024 * 1024)
    )
    const [projected] = await projectMessagesForMainModel([createImageReferenceMessage(images)])
    const urls = retainedUrls(projected?.content)

    expect(urls).not.toContain('data:image/webp;base64,AA9')
    expect(urls).not.toContain('data:image/webp;base64,AA10')
    expect(urls).toContain('data:image/webp;base64,AA11')
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
