import fs from 'node:fs/promises'
import path from 'node:path'
import { getSlides, getSlideShapes, getSlideText, isChartShape, loadPresentation } from 'pptx-kit'
import { describe, it } from 'vitest'
import type { JsonObject } from '../../../../../src/shared/types'
import { createPptToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

const coverHtml = `<section data-ppt-slide style="position:relative;width:1920px;height:1080px;background:#F5F0E8">
  <div style="position:absolute;left:100px;top:90px;width:1720px;height:220px;background:#17324D;border-radius:28px"></div>
  <h1 style="position:absolute;left:170px;top:145px;width:1450px;height:100px;color:#FFFFFF;font-size:64px">2026 产品复盘</h1>
  <p style="position:absolute;left:170px;top:420px;width:1480px;height:120px;color:#25313C;font-size:38px">收入增长 18%，交付质量继续提升。</p>
</section>`

const detailHtml = `<section data-ppt-slide style="position:relative;width:1920px;height:1080px;background:#FFFFFF">
  <h2 style="position:absolute;left:140px;top:100px;width:1500px;height:100px;color:#17324D;font-size:54px">核心结论</h2>
  <p style="position:absolute;left:160px;top:300px;width:1450px;height:120px;color:#333333;font-size:36px">下一季度重点：缩短反馈周期。</p>
  <span data-pptx-latex="E=mc^2" style="position:absolute;left:160px;top:520px;width:600px;height:160px"></span>
  <div data-pptx-chart="column" data-pptx-categories='["Q1","Q2"]' data-pptx-series='[{"name":"收入","values":[12,18]}]' style="position:absolute;left:900px;top:500px;width:760px;height:420px"></div>
</section>`

describe('ai tool ppt backend', () => {
  it('ppt-create-read-edit-commit', async () => {
    await runBackendCase({
      caseId: 'ppt-create-read-edit-commit',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['ppt'],
      description: '验证 ppt_edit 逐页创建、独立读取工具、写后回读、run 末一次写回和 diff。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const harness = createPptToolHarness(runtime)
        const sourcePath = 'product-review.pptx'
        const created = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath,
          action: { type: 'create_presentation', html: coverHtml }
        })
        const inserted = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath,
          action: { type: 'insert_slide', html: detailHtml }
        })
        const overview = await harness.invoke<JsonObject>('ppt_read_outline', {
          sourcePath,
          ranges: [{ type: 'percent', fromPercent: 0, toPercent: 100 }]
        })
        const firstSlideId = (overview.slides as Array<{ slideId: string }>)[0]!.slideId
        const readSlides = await harness.invoke<JsonObject>('ppt_read_slides', {
          sourcePath,
          ranges: [{ type: 'slide_ids', slideIds: [firstSlideId] }]
        })
        const failedDelete = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath,
          action: {
            type: 'delete_slides',
            slideIds: [firstSlideId, '/ppt/slides/missing.xml']
          }
        })
        const overviewAfterFailedDelete = await harness.invoke<JsonObject>('ppt_read_outline', {
          sourcePath,
          ranges: [{ type: 'slide_index', fromSlideIndex: 1, toSlideIndex: 2 }]
        })
        const replaced = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath,
          action: { type: 'replace_text', query: '反馈周期', replace: '客户反馈周期' }
        })
        const search = await harness.invoke<JsonObject>('ppt_search', {
          sourcePath,
          query: '客户反馈周期'
        })
        const rendered = await harness.invoke<JsonObject>('ppt_render_slides', {
          sourcePath,
          ranges: [{ type: 'slide_index', fromSlideIndex: 2, toSlideIndex: 2 }]
        })
        const targetPath = path.join(runtime.workspaceRoot, sourcePath)
        const beforeCommitExists = await fs
          .access(targetPath)
          .then(() => true)
          .catch(() => false)
        const records = await harness.runtime.commitAll()
        const repeatedCommitRecords = await harness.runtime.commitAll()
        const bytes = new Uint8Array(await fs.readFile(targetPath))
        const presentation = await loadPresentation(bytes)
        const texts = getSlides(presentation).map((slide) => getSlideText(slide))
        const hasChart = getSlides(presentation).some((slide) =>
          getSlideShapes(slide).some((shape) => isChartShape(shape))
        )
        const manifest = JSON.parse(await fs.readFile(records[0]!.previewPath!, 'utf8')) as {
          slides: Array<{ changed: boolean; after?: unknown; before?: unknown }>
        }
        return {
          created,
          inserted,
          overview,
          readSlides,
          failedDelete,
          overviewAfterFailedDelete,
          replaced,
          search,
          rendered,
          beforeCommitExists,
          records,
          repeatedCommitRecords,
          slideCount: getSlides(presentation).length,
          texts,
          hasChart,
          manifest
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.created.slideCount === 1 &&
            result.inserted.slideCount === 2 &&
            Boolean((result.created.postWriteReadback as JsonObject)?.slides) &&
            Boolean((result.inserted.postWriteReadback as JsonObject)?.slides) &&
            result.overview.slideCount === 2 &&
            Array.isArray(result.readSlides.slides) &&
            result.readSlides.slides.length === 1 &&
            result.failedDelete.ok === false &&
            result.overviewAfterFailedDelete.slideCount === 2 &&
            Array.isArray(result.search.matches) &&
            result.search.matches.length === 1 &&
            Array.isArray(result.rendered.images) &&
            result.rendered.images.length === 1 &&
            String((result.rendered.images as Array<{ path: string }>)[0]!.path).includes(
              '/.ncurator/runtime/assets/'
            ) &&
            String((result.rendered.images as Array<{ path: string }>)[0]!.path).includes(
              '/ppt-render/'
            ) &&
            result.beforeCommitExists === false,
          {
            name: 'ppt-draft-is-readable-before-single-run-commit',
            message: 'PPT 工作草稿应支持逐页创建、编辑和回读，且 commit 前不提前写正式文件。',
            data: result
          }
        )
        runtime.assertThat(
          result.records.length === 1 &&
            result.records[0]!.capability === 'ppt' &&
            result.records[0]!.operation === 'created' &&
            result.records[0]!.insertCount === 2 &&
            result.records[0]!.deleteCount === 0 &&
            result.repeatedCommitRecords.length === 0 &&
            result.slideCount === 2 &&
            result.hasChart &&
            result.texts.some((text) => text.includes('客户反馈周期')) &&
            result.manifest.slides.length === 2 &&
            result.manifest.slides.every((slide) => slide.changed && slide.after && !slide.before),
          {
            name: 'ppt-run-commits-one-file-record-and-diff',
            message: 'run 结束后应只写回一次 PPT，并生成页面级加减数量与 diff manifest。',
            data: result
          }
        )
      }
    })
  })
})
