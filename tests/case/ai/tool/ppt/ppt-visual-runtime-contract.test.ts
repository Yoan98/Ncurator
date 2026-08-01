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
      description: '验证受限 HTML PPT 的布局、字体、图片、追加、渲染和原子失败。',
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
        const created = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath: 'visual-runtime.pptx',
          actions: [
            {
              type: 'insert_slide',

              html: `<section data-ppt-slide style="position:relative;width:1920px;height:1080px;background:#F7F8FA">
                  <img data-ppt-element="image" id="sample" src="${pathToFileURL(imagePath).href}" style="position:absolute;left:1700px;top:72px;width:80px;height:80px;object-fit:contain" />
                  <div data-ppt-element="shape" id="band" style="position:absolute;left:96px;top:72px;width:1728px;height:168px;background:#17324D;border-radius:18px"></div>
                  <h1 data-ppt-element="text" id="title" style="position:absolute;left:144px;top:112px;width:1500px;height:96px;color:#FFFFFF;font-family:Microsoft YaHei;font-size:72px;font-weight:700">季度经营复盘</h1>
                  <p data-ppt-element="text" id="summary" style="position:absolute;left:144px;top:330px;width:1500px;height:96px;color:rgb(30,41,59);font-size:34px">收入增长 18%，交付质量保持稳定</p>
                </section>`
            },
            {
              type: 'insert_slide',

              html: `<section data-ppt-slide style="position:relative;width:1920px;height:1080px;background:#FFFFFF">
                  <img data-ppt-element="image" id="remote" src="http://127.0.0.1:1/missing.png" style="position:absolute;left:120px;top:120px;width:320px;height:180px;object-fit:contain" />
                  <h1 data-ppt-element="text" id="remote-title" style="position:absolute;left:520px;top:120px;width:1200px;height:100px;color:#111827;font-size:72px">远程图片失败也继续生成</h1>
                </section>`
            }
          ]
        })
        const createdSlides = (created.postWriteReadback as { slides?: Array<{ slideId: string }> })
          .slides!
        const inserted = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath: 'visual-runtime.pptx',
          actions: [
            {
              type: 'insert_slide',

              location: { slideId: createdSlides[0]!.slideId, position: 'before' },
              html: `<section data-ppt-slide style="position:relative;width:1920px;height:1080px;background:#FFFFFF">
                <div data-ppt-element="shape" id="second-band" style="position:absolute;left:120px;top:120px;width:1680px;height:180px;background:#17324D"></div>
                <h2 data-ppt-element="text" id="second-title" style="position:absolute;left:160px;top:155px;width:1400px;height:100px;color:#FFFFFF;font-size:72px">第二页可以在独立调用中追加</h2>
              </section>`
            }
          ]
        })
        const insertedSlideId = (
          inserted.postWriteReadback as { slides?: Array<{ slideId: string }> }
        ).slides![0]!.slideId
        const moved = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath: 'visual-runtime.pptx',
          actions: [
            {
              type: 'move_slide',
              slideId: createdSlides[1]!.slideId,

              location: { slideId: createdSlides[0]!.slideId, position: 'before' }
            }
          ]
        })
        const duplicated = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath: 'visual-runtime.pptx',
          actions: [
            {
              type: 'duplicate_slide',
              slideId: createdSlides[0]!.slideId,

              location: { slideId: createdSlides[0]!.slideId, position: 'after' }
            }
          ]
        })
        const orderedSlides = await harness.runtime.readSlides({
          sourcePath: path.join(runtime.workspaceRoot, 'visual-runtime.pptx'),
          ranges: [{ type: 'slide_index', fromSlideIndex: 1, toSlideIndex: 4 }]
        })
        const rendered = await harness.runtime.render({
          sourcePath: path.join(runtime.workspaceRoot, 'visual-runtime.pptx'),
          ranges: [{ type: 'slide_index', fromSlideIndex: 1, toSlideIndex: 4 }]
        })
        const invalid = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath: 'invalid.pptx',
          actions: [
            {
              type: 'insert_slide',

              html: '<section data-ppt-slide style="width:1920px;height:1080px"><h1 data-ppt-element="text" style="position:absolute;left:100px;top:100px;width:800px;height:100px;font-size:72px">有效页面</h1></section>'
            },
            {
              type: 'insert_slide',

              html: '<section><h1>无效页面</h1></section>'
            }
          ]
        })
        const slides = (created.postWriteReadback as { slides?: unknown[] } | undefined)?.slides as
          | Array<{
              elements: Array<{
                text?: string
                bounds: { x: number; y: number; width: number }
                style?: { fontFamily?: string; fontSize?: number }
              }>
            }>
          | undefined
        const title = slides?.[0]?.elements.find((element) => element.text === '季度经营复盘')
        const images = rendered.images as Array<{ path: string }>
        return {
          created,
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
          pptxSize: (await fs.stat(path.join(runtime.workspaceRoot, 'visual-runtime.pptx'))).size,
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
            Math.abs(Number(result.title?.bounds.width) - 1572) < 2 &&
            result.title?.style?.fontFamily === 'Microsoft YaHei' &&
            Math.abs(Number(result.title?.style?.fontSize) - 36) < 2 &&
            result.pptxSize > 1000,
          {
            name: 'ppt-html-layout-runtime',
            message: 'PPT HTML runtime 应生成可解析文件并保持代表性布局和字体契约。',
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
            message: 'PPT 的插入、移动和复制应按 position 和 anchorSlideId 生成正确顺序。',
            data: result.orderedSlideTexts
          }
        )
        runtime.assertThat(result.invalid.ok === false && result.invalidExists === false, {
          name: 'ppt-invalid-multipage-is-atomic',
          message: '多页创建中任一 HTML 非法时应整体失败且不留下半成品。',
          data: result.invalid
        })
      }
    })
  }, 90_000)
})
