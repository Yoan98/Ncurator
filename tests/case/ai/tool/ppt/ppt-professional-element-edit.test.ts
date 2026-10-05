import fs from 'node:fs/promises'
import path from 'node:path'
import { getSlides, loadPresentation } from 'pptx-kit'
import { describe, it } from 'vitest'
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
                  ['增长', '18%']
                ]
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
        return {
          updatedSlides: updatedReadback.slides,
          duplicated,
          records,
          slideCount: getSlides(presentation).length
        }
      },
      assert: async (result, runtime) => {
        const updatedSlides = result.updatedSlides as Array<{ elements: Array<JsonObject> }>
        const elements = updatedSlides[0]!.elements
        const table = elements.find((element) => element.type === 'table')
        const chart = elements.find((element) => element.type === 'chart')
        const formula = elements.find((element) => element.type === 'formula')
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
