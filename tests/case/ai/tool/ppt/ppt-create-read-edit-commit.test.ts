import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getSlides, getSlideShapes, getSlideText, isChartShape, loadPresentation } from 'pptx-kit'
import { describe, it } from 'vitest'
import type { JsonObject } from '../../../../../src/shared/types'
import { createPptToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

const coverSlide = {
  type: 'insert_slide' as const,
  background: '#F5F0E8',
  elements: [
    {
      type: 'shape' as const,
      shape: 'roundRect' as const,
      bounds: { x: 50, y: 45, width: 860, height: 110 },
      style: { fill: '#17324D' }
    },
    {
      type: 'text' as const,
      text: '2026 产品复盘',
      bounds: { x: 85, y: 68, width: 790, height: 60 },
      style: { color: '#FFFFFF', fontSize: 36, bold: true }
    },
    {
      type: 'text' as const,
      text: '收入增长 18%，交付质量继续提升。',
      bounds: { x: 85, y: 210, width: 790, height: 60 },
      style: { color: '#25313C', fontSize: 18 }
    }
  ]
}

const detailSlide = {
  type: 'insert_slide' as const,
  background: '#FFFFFF',
  elements: [
    {
      type: 'text' as const,
      text: '核心结论',
      bounds: { x: 70, y: 50, width: 820, height: 55 },
      style: { color: '#17324D', fontSize: 36, bold: true }
    },
    {
      type: 'text' as const,
      text: '下一季度重点：缩短反馈周期。',
      bounds: { x: 80, y: 150, width: 800, height: 60 },
      style: { color: '#333333', fontSize: 18 }
    },
    {
      type: 'formula' as const,
      latex: 'E=mc^2',
      bounds: { x: 80, y: 260, width: 300, height: 80 }
    },
    {
      type: 'chart' as const,
      bounds: { x: 450, y: 250, width: 380, height: 210 },
      chartType: 'column' as const,
      categories: ['Q1', 'Q2'],
      series: [{ name: '收入', values: [12, 18] }]
    }
  ]
}

describe('ai tool ppt backend', () => {
  it('ppt-create-read-edit-commit', async () => {
    await runBackendCase({
      caseId: 'ppt-create-read-edit-commit',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['ppt'],
      description: '验证 ppt_edit 按元素规格创建、独立读取工具、写后回读、run 末一次写回和 diff。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = path.join(runtime.workspaceRoot, 'product-review.pptx')
        const harness = createPptToolHarness(runtime)
        const created = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath,
          ...coverSlide
        })
        const inserted = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath,
          ...detailSlide
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
        const readImagesOnly = await harness.invoke<JsonObject>('ppt_read_slides', {
          sourcePath,
          detail: 'images',
          ranges: [{ type: 'slide_ids', slideIds: [firstSlideId] }]
        })
        const failedDelete = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath,
          type: 'delete_slides',
          slideIds: [firstSlideId, '/ppt/slides/missing.xml']
        })
        const overviewAfterFailedDelete = await harness.invoke<JsonObject>('ppt_read_outline', {
          sourcePath,
          ranges: [{ type: 'slide_index', fromSlideIndex: 1, toSlideIndex: 2 }]
        })
        const replaced = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath,
          type: 'replace_text',
          query: '反馈周期',
          replace: '客户反馈周期'
        })
        const missingReplace = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath,
          type: 'replace_text',
          query: '不存在的文本',
          replace: '不会写入'
        })
        const search = await harness.invoke<JsonObject>('ppt_search', {
          sourcePath,
          query: '客户反馈周期'
        })
        const targetPath = sourcePath
        const beforeCommitExists = await fs
          .access(targetPath)
          .then(() => true)
          .catch(() => false)
        const aiPersistedBytes = new Uint8Array(await fs.readFile(targetPath))
        const aiPersistedChecksum = createHash('sha256').update(aiPersistedBytes).digest('hex')
        await fs.writeFile(
          targetPath,
          Buffer.concat([Buffer.from(aiPersistedBytes), Buffer.from('external-user-change')])
        )
        const externallyChangedChecksum = createHash('sha256')
          .update(await fs.readFile(targetPath))
          .digest('hex')
        const records = (await harness.ctx.finalizeRunFileChanges()).filter(
          (record) => record.capability === 'ppt'
        )
        const repeatedCommitRecords = (await harness.ctx.finalizeRunFileChanges()).filter(
          (record) => record.capability === 'ppt'
        )
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
          readImagesOnly,
          failedDelete,
          overviewAfterFailedDelete,
          replaced,
          missingReplace,
          search,
          beforeCommitExists,
          aiPersistedChecksum,
          externallyChangedChecksum,
          records,
          repeatedCommitRecords,
          slideCount: getSlides(presentation).length,
          texts,
          hasChart,
          manifest
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(result.beforeCommitExists === true, {
          name: 'ppt-edit-writes-real-file-immediately',
          message: 'ppt_edit 返回成功前必须已经写入真实 PPTX 文件。',
          data: { beforeCommitExists: result.beforeCommitExists }
        })
        const readSlideImagePath = String(
          (result.readSlides.slides as Array<{ slideImagePath?: string }>)[0]?.slideImagePath || ''
        )
        const imagesOnlySlide = (
          result.readImagesOnly.slides as Array<{
            slideId?: string
            slideIndex?: number
            slideImagePath?: string
            elements?: unknown
            text?: string
          }>
        )[0]
        const imagesOnlyPath = String(imagesOnlySlide?.slideImagePath || '')
        const imagesOnlyExists = await fs
          .access(imagesOnlyPath)
          .then(() => true)
          .catch(() => false)
        const readSlideImageExists = await fs
          .access(readSlideImagePath)
          .then(() => true)
          .catch(() => false)
        runtime.assertThat(
          typeof result.created.slideId === 'string' &&
            typeof result.inserted.slideId === 'string' &&
            Array.isArray(result.created.createdElementIds) &&
            Array.isArray(result.inserted.createdElementIds) &&
            result.overview.slideCount === 2 &&
            Array.isArray(result.readSlides.slides) &&
            result.readSlides.slides.length === 1 &&
            result.readImagesOnly.detail === 'images' &&
            Array.isArray(result.readImagesOnly.slides) &&
            result.readImagesOnly.slides.length === 1 &&
            typeof imagesOnlySlide?.slideId === 'string' &&
            typeof imagesOnlySlide?.slideIndex === 'number' &&
            imagesOnlySlide?.elements === undefined &&
            imagesOnlySlide?.text === undefined &&
            imagesOnlyExists &&
            typeof result.failedDelete.error === 'string' &&
            result.overviewAfterFailedDelete.slideCount === 2 &&
            !JSON.stringify(result.overviewAfterFailedDelete).includes('不应落盘的标题') &&
            typeof result.missingReplace.error === 'string' &&
            String(result.missingReplace.error).includes('The text to replace was not found') &&
            !Object.hasOwn(result.overview, 'warnings') &&
            !Object.hasOwn(result.created, 'warnings') &&
            Array.isArray(result.search.matches) &&
            result.search.matches.length === 1 &&
            result.search.truncated === false &&
            readSlideImageExists &&
            /[\\/]partners[\\/][^\\/]+[\\/]runtime[\\/]assets[\\/]ppt_read_slides-[^\\/]+[\\/][a-f0-9]{64}\.png$/u.test(
              readSlideImagePath.replace(/\\/g, '/')
            ),
          {
            name: 'ppt-edit-persists-before-run-finalization',
            message: 'PPT 编辑成功后应立即写入正式文件，同时保持后续读取和 run 级差异生成能力。',
            data: result
          }
        )
        runtime.assertThat(
          result.records.length === 1 &&
            result.records[0]!.capability === 'ppt' &&
            result.records[0]!.operation === 'created' &&
            result.records[0]!.insertCount === 2 &&
            result.records[0]!.deleteCount === 0 &&
            result.records[0]!.afterChecksum === result.aiPersistedChecksum &&
            result.records[0]!.afterChecksum !== result.externallyChangedChecksum &&
            result.repeatedCommitRecords.length === 1 &&
            result.repeatedCommitRecords[0]?.previewPath === result.records[0]?.previewPath &&
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
  }, 120_000)
})
