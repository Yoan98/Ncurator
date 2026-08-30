import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, it } from 'vitest'
import type { JsonObject } from '../../../../../src/shared/types'
import { createPptToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

describe('ai tool ppt visual backend', () => {
  it('ppt-visual-runtime-contract', async () => {
    await runBackendCase({
      caseId: 'ppt-visual-runtime-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['ppt'],
      description: '验证元素规格 PPT 的布局、字体、图片、追加、渲染和原子失败。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const imagePath = path.join(runtime.workspaceRoot, 'sample.png')
        await fs.writeFile(
          imagePath,
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
            'base64'
          )
        )
        const harness = createPptToolHarness(runtime)
        const sourcePath = path.join(runtime.workspaceRoot, 'visual-runtime.pptx')
        const cover = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath,
          type: 'insert_slide',
          background: '#F7F8FA',
          elements: [
            {
              type: 'image',
              assetPath: pathToFileURL(imagePath).href,
              bounds: { x: 820, y: 72, width: 80, height: 80 },
              fit: 'contain'
            },
            {
              type: 'shape',
              shape: 'roundRect',
              bounds: { x: 48, y: 72, width: 864, height: 120 },
              style: { fill: '#17324D' }
            },
            {
              type: 'text',
              text: '季度经营复盘',
              bounds: { x: 144, y: 112, width: 780, height: 96 },
              style: { color: '#FFFFFF', fontFamily: 'Microsoft YaHei', fontSize: 36, bold: true }
            },
            {
              type: 'text',
              text: '收入增长 18%，交付质量保持稳定',
              bounds: { x: 144, y: 330, width: 780, height: 96 },
              style: { color: '#1E293B', fontSize: 18 }
            }
          ]
        })
        const remote = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath,
          type: 'insert_slide',
          background: '#FFFFFF',
          elements: [
            {
              type: 'image',
              assetPath: 'http://127.0.0.1:1/missing.png',
              bounds: { x: 120, y: 120, width: 320, height: 180 },
              fit: 'contain'
            },
            {
              type: 'text',
              text: '远程图片失败也继续生成',
              bounds: { x: 520, y: 120, width: 400, height: 80 },
              style: { color: '#111827', fontSize: 36 }
            }
          ]
        })
        const createdSlides = [String(cover.slideId), String(remote.slideId)]
        const inserted = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath,
          type: 'insert_slide',
          location: { slideId: createdSlides[0]!, position: 'before' },
          background: '#FFFFFF',
          elements: [
            {
              type: 'shape',
              shape: 'rect',
              bounds: { x: 60, y: 120, width: 840, height: 120 },
              style: { fill: '#17324D' }
            },
            {
              type: 'text',
              text: '第二页可以在独立调用中追加',
              bounds: { x: 80, y: 155, width: 760, height: 80 },
              style: { color: '#FFFFFF', fontSize: 36 }
            }
          ]
        })
        const insertedSlideId = String(inserted.slideId || '')
        const moved = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath,
          type: 'move_slide',
          slideId: createdSlides[1]!,
          location: { slideId: createdSlides[0]!, position: 'before' }
        })
        const duplicated = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath,
          type: 'duplicate_slide',
          slideId: createdSlides[0]!,
          location: { slideId: createdSlides[0]!, position: 'after' }
        })
        const orderedSlides = await harness.runtime.readSlides({
          sourcePath,
          ranges: [{ type: 'slide_index', fromSlideIndex: 1, toSlideIndex: 4 }]
        })
        const rendered = await harness.runtime.render({
          sourcePath,
          ranges: [{ type: 'slide_index', fromSlideIndex: 1, toSlideIndex: 4 }]
        })
        const invalid = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath: path.join(runtime.workspaceRoot, 'invalid.pptx'),
          type: 'insert_slide',
          elements: [
            {
              type: 'text',
              text: '出画布',
              bounds: { x: 1800, y: 100, width: 200, height: 80 }
            }
          ]
        })
        const createdRead = await harness.invoke<JsonObject>('ppt_read_slides', {
          sourcePath,
          ranges: [{ type: 'slide_ids', slideIds: createdSlides }]
        })
        const slides = createdRead.slides as
          | Array<{
              elements: Array<{
                text?: string
                bounds: { x: number; y: number; width: number }
                style?: { fontFamily?: string; fontSize?: number }
              }>
            }>
          | undefined
        const title = slides
          ?.flatMap((slide) => slide.elements)
          .find((element) => element.text === '季度经营复盘')
        const images = rendered.images as Array<{ path: string }>
        return {
          created: cover,
          inserted,
          insertedSlideId,
          moved,
          duplicated,
          orderedSlideTexts: (orderedSlides.slides as Array<{ text?: string }>).map(
            (slide) => slide.text || ''
          ),
          invalid,
          title,
          slideCount: slides?.length,
          imageCount: images.length,
          imageSizes: await Promise.all(
            images.map(async (image) => (await fs.stat(image.path)).size)
          ),
          pptxSize: (await fs.stat(sourcePath)).size,
          invalidExists: await fs
            .access(path.join(runtime.workspaceRoot, 'invalid.pptx'))
            .then(() => true)
            .catch(() => false)
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.slideCount === 2 &&
            result.title?.bounds.x === 144 &&
            result.title?.bounds.y === 112 &&
            Math.abs(Number(result.title?.bounds.width) - 780) < 2 &&
            result.title?.style?.fontFamily === 'Microsoft YaHei' &&
            Math.abs(Number(result.title?.style?.fontSize) - 36) < 2 &&
            result.pptxSize > 1000,
          {
            name: 'ppt-element-spec-layout-runtime',
            message: 'PPT 元素规格应生成可解析文件并保持代表性布局和字体契约。',
            data: result
          }
        )
        runtime.assertThat(
          result.imageCount === 4 && result.imageSizes.every((size) => size > 1000),
          {
            name: 'ppt-rendered-slide-images',
            message: '定位、移动和复制后的四页 PPT 均应渲染成非空图片。',
            data: result.imageSizes
          }
        )
        runtime.assertThat(
          result.insertedSlideId &&
            result.moved.ok !== false &&
            result.duplicated.ok !== false &&
            result.orderedSlideTexts[0]?.includes('第二页可以在独立调用中追加') &&
            result.orderedSlideTexts[1]?.includes('远程图片失败也继续生成') &&
            result.orderedSlideTexts[2]?.includes('季度经营复盘') &&
            result.orderedSlideTexts[3]?.includes('季度经营复盘'),
          {
            name: 'ppt-position-anchor-runtime',
            message: 'PPT 的插入、移动和复制应按 position 和 slideId 生成正确顺序。',
            data: result.orderedSlideTexts
          }
        )
        runtime.assertThat(result.invalid.ok === false && result.invalidExists === false, {
          name: 'ppt-invalid-spec-is-atomic',
          message: '出画布元素应整次失败且不留下半成品。',
          data: result.invalid
        })
      }
    })
  }, 90_000)
})
