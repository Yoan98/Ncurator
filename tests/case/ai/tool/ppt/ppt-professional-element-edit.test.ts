import fs from 'node:fs/promises'
import path from 'node:path'
import {
  getSlides,
  getSlideShapes,
  getTableCells,
  getTableCellParagraphs,
  getTableColumnWidths,
  getTableRowHeights,
  isTableShape,
  loadPresentation
} from 'pptx-kit'
import { findPptTableOverflows } from '../../../../../src/main/services/ai/human/tools/ppt/textLayout'
import type { PptDiffManifest } from '../../../../../src/main/services/ai/human/tools/ppt/types'
import { describe, it } from 'vitest'
import { DOMParser } from '@xmldom/xmldom'
import type { JsonObject } from '../../../../../src/shared/types'
import { createPptToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

const baseSlide = {
  type: 'insert_slide' as const,
  background: '#FFFFFF',
  elements: [
    {
      type: 'text' as const,
      text: '专业编辑验证',
      bounds: { x: 140, y: 100, width: 780, height: 110 },
      style: { color: '#17324D', fontSize: 36 }
    }
  ]
}

describe('ai tool ppt professional editing', () => {
  it('ppt-professional-element-edit', async () => {
    await runBackendCase({
      caseId: 'ppt-professional-element-edit',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['ppt'],
      description: '验证 PPT 元素插入、复制、图层、样式、表格、图表、公式和页面复制。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const harness = createPptToolHarness(runtime)
        const sourcePath = path.join(runtime.workspaceRoot, 'professional-edit.pptx')
        await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath,
          ...baseSlide
        })
        const outline = await harness.invoke<JsonObject>('ppt_read_outline', {
          sourcePath,
          ranges: [{ type: 'percent', fromPercent: 0, toPercent: 100 }]
        })
        const slideId = (outline.slides as Array<{ slideId: string }>)[0]!.slideId
        const initial = await harness.invoke<JsonObject>('ppt_read_slides', {
          sourcePath,
          ranges: [{ type: 'slide_ids', slideIds: [slideId] }]
        })
        const initialElements = (initial.slides as Array<{ elements: Array<JsonObject> }>)[0]!
          .elements
        const titleId = String(
          initialElements.find((element) => String(element.text || '') === '专业编辑验证')
            ?.elementId
        )

        await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath,
          type: 'edit_elements',
          slideId,
          operations: [
            { type: 'duplicate_element', elementId: titleId },
            {
              type: 'add_element',
              element: {
                type: 'line',
                from: { x: 140, y: 250 },
                to: { x: 820, y: 250 },
                color: '#C18B25',
                width: 3,
                arrowEnd: true
              }
            },
            {
              type: 'add_element',
              element: {
                type: 'table',
                bounds: { x: 140, y: 300, width: 360, height: 150 },
                rows: [
                  ['指标', '结果'],
                  ['增长', '18%'],
                  ['负责人', '王海涛（供应链总监）']
                ],
                columnWidths: [200, 160],
                rowHeights: [30, 50, 70],
                fontSize: 18
              }
            },
            {
              type: 'add_element',
              element: {
                type: 'chart',
                bounds: { x: 520, y: 300, width: 360, height: 150 },
                chartType: 'column',
                categories: ['Q1', 'Q2'],
                series: [{ name: '收入', values: [12, 18] }]
              }
            },
            {
              type: 'add_element',
              element: {
                type: 'formula',
                bounds: { x: 140, y: 470, width: 360, height: 60 },
                latex: 'E=mc^2'
              }
            }
          ]
        })
        const insertedReadback = await harness.invoke<JsonObject>('ppt_read_slides', {
          sourcePath,
          ranges: [{ type: 'slide_ids', slideIds: [slideId] }]
        })
        const elements = (insertedReadback.slides as Array<{ elements: Array<JsonObject> }>)[0]!
          .elements
        const tableId = String(elements.find((element) => element.type === 'table')?.elementId)
        const chartId = String(elements.find((element) => element.type === 'chart')?.elementId)
        const formulaId = String(elements.find((element) => element.type === 'formula')?.elementId)
        const duplicateId = String(
          elements.filter((element) => element.text === '专业编辑验证').at(-1)?.elementId
        )

        const beforeInvalid = await fs.readFile(sourcePath)
        const invalidDimensions = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath,
          type: 'edit_elements',
          slideId,
          operations: [{ type: 'update_table', elementId: tableId, columnWidths: [10] }]
        })
        const invalidOverflow = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath,
          type: 'edit_elements',
          slideId,
          operations: [{ type: 'update_table', elementId: tableId, fontSize: 120 }]
        })
        const failedWritesUnchanged = beforeInvalid.equals(await fs.readFile(sourcePath))
        await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath,
          type: 'edit_elements',
          slideId,
          operations: [
            {
              type: 'update_table',
              elementId: tableId,
              columnWidths: [270, 90],
              rowHeights: [30, 50, 70],
              fontSize: 14,
              fontFamily: 'Arial'
            }
          ]
        })

        await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath,
          type: 'edit_elements',
          slideId,
          operations: [
            {
              type: 'set_style',
              elementId: titleId,
              style: { underline: true, verticalAlign: 'middle', color: '#7A241E' }
            },
            { type: 'set_z_order', elementId: duplicateId, placement: 'back' },
            {
              type: 'update_table',
              elementId: tableId,
              cells: [{ rowIndex: 2, columnIndex: 2, text: '24%' }]
            },
            {
              type: 'update_chart',
              elementId: chartId,
              chartType: 'line',
              categories: ['Q1', 'Q2'],
              series: [{ name: '收入', values: [15, 24] }],
              title: '收入趋势'
            },
            { type: 'update_formula', elementId: formulaId, latex: 'a^2+b^2=c^2' }
          ]
        })
        const duplicated = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath,
          type: 'duplicate_slide',
          slideId,
          location: { slideId: slideId, position: 'after' }
        })
        const updatedReadback = await harness.invoke<JsonObject>('ppt_read_slides', {
          sourcePath,
          ranges: [{ type: 'slide_ids', slideIds: [slideId] }]
        })
        const records = (await harness.ctx.finalizeRunFileChanges()).filter(
          (record) => record.capability === 'ppt'
        )
        const presentation = await loadPresentation(new Uint8Array(await fs.readFile(sourcePath)))
        const finalTable = getSlideShapes(getSlides(presentation)[0]!).find(isTableShape)!
        const manifest = JSON.parse(
          await fs.readFile(records[0]!.previewPath!, 'utf8')
        ) as PptDiffManifest
        const frame = manifest.slides.find((slide) => slide.after?.index === 1)!.after!
        const svg = await fs.readFile(
          path.resolve(path.dirname(records[0]!.previewPath!), frame.svg),
          'utf8'
        )
        const formatHarness = createPptToolHarness(runtime, { runId: `${runtime.runId}-format` })
        await formatHarness.invoke<JsonObject>('ppt_edit', {
          sourcePath,
          type: 'edit_elements',
          slideId,
          operations: [{ type: 'update_table', elementId: tableId, fontSize: 13 }]
        })
        const formatRecords = await formatHarness.ctx.finalizeRunFileChanges()
        const formatManifest = JSON.parse(
          await fs.readFile(formatRecords[0]!.previewPath!, 'utf8')
        ) as PptDiffManifest
        const formatSlide = formatManifest.slides.find((slide) => slide.after?.index === 1)!
        const beforeFormatSvg = await fs.readFile(formatSlide.before!.svg, 'utf8')
        const afterFormatSvg = await fs.readFile(formatSlide.after!.svg, 'utf8')
        return {
          updatedSlides: updatedReadback.slides,
          duplicated,
          records,
          slideCount: getSlides(presentation).length,
          columnWidths: getTableColumnWidths(finalTable).map((value) => Number(value) / 12700),
          rowHeights: getTableRowHeights(finalTable).map((value) => Number(value) / 12700),
          formats: getTableCells(finalTable).flatMap((row) =>
            row.flatMap((cell) =>
              getTableCellParagraphs(cell).flatMap((paragraph) =>
                paragraph.elements.map((element) => element.format)
              )
            )
          ),
          overflows: findPptTableOverflows(presentation, finalTable, svg),
          reviewHasFullName:
            new DOMParser()
              .parseFromString(svg, 'image/svg+xml')
              .documentElement.textContent?.includes('王海涛（供应链总监）') === true,
          formatChangeMarked:
            formatRecords.length === 1 &&
            formatRecords[0]!.operation === 'updated' &&
            formatSlide.elementChanges.length === 1 &&
            formatSlide.elementChanges[0]!.kind === 'modified' &&
            beforeFormatSvg.includes('font-size="18.67"') &&
            afterFormatSvg.includes('font-size="17.33"'),
          failedWritesUnchanged,
          invalidDimensions,
          invalidOverflow
        }
      },
      assert: async (result, runtime) => {
        const updatedSlides = result.updatedSlides as Array<{ elements: Array<JsonObject> }>
        const elements = updatedSlides[0]!.elements
        const table = elements.find((element) => element.type === 'table')
        const chart = elements.find((element) => element.type === 'chart')
        const formula = elements.find((element) => element.type === 'formula')
        runtime.assertThat(
          result.columnWidths.join(',') === '270,90' &&
            result.rowHeights.join(',') === '30,50,70' &&
            result.formats.every(
              (format) =>
                format?.size === 14 && format.font === 'Arial' && format.fontEastAsian === 'Arial'
            ) &&
            result.overflows.length === 0 &&
            result.reviewHasFullName &&
            result.formatChangeMarked &&
            result.failedWritesUnchanged &&
            Boolean(result.invalidDimensions.error) &&
            String(result.invalidOverflow.error).includes('文字超出边界'),
          {
            name: 'ppt-table-layout-and-self-contained-review',
            message:
              '表格布局和字体必须真实写入，审核中全角括号完整且文字不溢出；失败调用不得发布文件。',
            data: result
          }
        )
        runtime.assertThat(
          elements.some((element) => element.type === 'connector') &&
            (table?.details as { rows?: string[][] })?.rows?.[1]?.[1] === '24%' &&
            (chart?.details as { chartType?: string })?.chartType === 'line' &&
            formula?.latex === 'a^2+b^2=c^2' &&
            typeof result.duplicated.slideId === 'string' &&
            result.records.length === 1 &&
            result.slideCount === 2,
          {
            name: 'ppt-professional-operations-round-trip',
            message: 'PPT 专业元素操作和页面复制应写入成功，并能通过 read_slides 回读。',
            data: result
          }
        )
      }
    })
  })
})
