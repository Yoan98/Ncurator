import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createPptToolRuntime } from '../../../../src/main/services/ai/human/tools/ppt/runtime'

describe('ppt visual smoke', () => {
  it('writes and renders a representative restricted HTML slide', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-ppt-smoke-'))
    try {
      const runtime = createPptToolRuntime({
        ctx: { saveFileChangeRecord: async () => undefined } as never,
        cache: {} as never,
        runId: 'smoke-run',
        sessionId: 'smoke-session',
        taskId: 'smoke-task',
        workspaceRootPath: root,
        emitActivity: () => undefined
      })
      const imagePath = path.join(root, 'sample.png')
      await fs.writeFile(
        imagePath,
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
          'base64'
        )
      )
      const created = await runtime.edit({
        sourcePath: 'visual-smoke.pptx',
        actions: [
          {
            type: 'create_presentation',
            html: `<section data-ppt-slide style="position:relative;width:1920px;height:1080px;background:#F7F8FA">
          <img data-ppt-element="image" id="sample" src="${pathToFileURL(imagePath).href}" style="position:absolute;left:1700px;top:72px;width:80px;height:80px;object-fit:contain" />
          <div data-ppt-element="shape" id="band" style="position:absolute;left:96px;top:72px;width:1728px;height:168px;background:#17324D;border-radius:18px"></div>
          <h1 data-ppt-element="text" id="title" style="position:absolute;left:144px;top:112px;width:1500px;height:96px;color:#FFFFFF;font-family:Microsoft YaHei;font-size:72px;font-weight:700">季度经营复盘</h1>
          <p data-ppt-element="text" id="summary" style="position:absolute;left:144px;top:330px;width:1500px;height:96px;color:rgb(30,41,59);font-size:34px">收入增长 18%，交付质量保持稳定</p>
          <div data-ppt-element="shape" id="card" style="position:absolute;left:144px;top:500px;width:760px;height:300px;background:#FFFFFF;border-top:3px solid #16A34A;border-bottom:1px solid #D1D5DB"></div>
          <p data-ppt-element="text" id="cardText" style="position:absolute;left:192px;top:560px;width:650px;height:100px;color:#334155;font-size:30px">绿色标记代表本次内容改动</p>
        </section>`
          }
        ]
      })
      const inserted = await runtime.edit({
        sourcePath: 'visual-smoke.pptx',
        actions: [
          {
            type: 'insert_slide',
            html: `<section data-ppt-slide style="position:relative;width:1920px;height:1080px;background:#FFFFFF">
          <div data-ppt-element="shape" id="second-band" style="position:absolute;left:120px;top:120px;width:1680px;height:180px;background:#17324D"></div>
          <h2 data-ppt-element="text" id="second-title" style="position:absolute;left:160px;top:155px;width:1400px;height:100px;color:#FFFFFF;font-size:72px">第二页可以在独立调用中追加</h2>
        </section>`
          }
        ]
      })
      const pptxPath = path.join(root, 'visual-smoke.pptx')
      const rendered = await runtime.render({
        sourcePath: pptxPath,
        ranges: [{ type: 'slide_index', fromSlideIndex: 1, toSlideIndex: 2 }]
      })
      const renderedImages = rendered.images as Array<{ path: string }>
      expect(created.warnings).not.toContain(
        'Chromium layout was unavailable; explicit element bounds were used.'
      )
      expect(inserted.warnings).not.toContain(
        'Chromium layout was unavailable; explicit element bounds were used.'
      )
      const createdSlides = (
        created.postWriteReadback as {
          slides: Array<{
            elements: Array<{
              text?: string
              bounds: { x: number; y: number; width: number }
              style?: { fontFamily?: string; fontSize?: number }
            }>
          }>
        }
      ).slides
      const title = createdSlides[0]!.elements.find((element) => element.text === '季度经营复盘')
      expect(title?.bounds.x).toBeCloseTo(144, 0)
      expect(title?.bounds.y).toBeCloseTo(112, 0)
      expect(title?.bounds.width).toBeCloseTo(1572, 0)
      expect(title?.style?.fontFamily).toBe('Microsoft YaHei')
      expect(title?.style?.fontSize).toBeCloseTo(36, 1)
      expect((await fs.stat(pptxPath)).size).toBeGreaterThan(1000)
      expect(renderedImages).toHaveLength(2)
      await Promise.all(
        renderedImages.map(async (image) =>
          expect((await fs.stat(image.path)).size).toBeGreaterThan(1000)
        )
      )
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  }, 15_000)
})
