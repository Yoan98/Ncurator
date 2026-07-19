import fs from 'node:fs/promises'
import path from 'node:path'
import { getSlides, loadPresentation } from 'pptx-kit'
import { describe, it } from 'vitest'
import type { JsonObject } from '../../../../../src/shared/types'
import { createPptToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

const baseHtml = `<section data-ppt-slide style="position:relative;width:1920px;height:1080px;background:#FFFFFF">
  <h1 style="position:absolute;left:140px;top:100px;width:1500px;height:110px;color:#17324D;font-size:72px">专业编辑验证</h1>
</section>`

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
        const sourcePath = 'professional-edit.pptx'
        await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath,
          actions: [{ type: 'create_presentation', html: baseHtml }]
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
          initialElements.find((element) => element.type === 'shape')?.elementId
        )

        const inserted = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath,
          actions: [
            {
              type: 'edit_elements',
              slideId,
              operations: [
                { type: 'duplicate_element', elementId: titleId },
                {
                  type: 'add_element',
                  element: {
                    type: 'line',
                    from: { x: 140, y: 250 },
                    to: { x: 1760, y: 250 },
                    color: '#C18B25',
                    width: 3,
                    arrowEnd: true
                  }
                },
                {
                  type: 'add_element',
                  element: {
                    type: 'table',
                    bounds: { x: 140, y: 330, width: 700, height: 300 },
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
                    bounds: { x: 980, y: 330, width: 700, height: 340 },
                    chartType: 'column',
                    categories: ['Q1', 'Q2'],
                    series: [{ name: '收入', values: [12, 18] }]
                  }
                },
                {
                  type: 'add_element',
                  element: {
                    type: 'formula',
                    bounds: { x: 140, y: 730, width: 650, height: 180 },
                    latex: 'E=mc^2'
                  }
                }
              ]
            }
          ]
        })
        const insertedSlides = (inserted.postWriteReadback as { slides: Array<JsonObject> }).slides
        const elements = insertedSlides[0]!.elements as Array<JsonObject>
        const tableId = String(elements.find((element) => element.type === 'table')?.elementId)
        const chartId = String(elements.find((element) => element.type === 'chart')?.elementId)
        const formulaId = String(elements.find((element) => element.type === 'formula')?.elementId)
        const duplicateId = String(
          elements.filter((element) => element.text === '专业编辑验证').at(-1)?.elementId
        )

        const updated = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath,
          actions: [
            {
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
            }
          ]
        })
        const duplicated = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath,
          actions: [{ type: 'duplicate_slide', slideId }]
        })
        const records = await harness.runtime.commitAll()
        const presentation = await loadPresentation(
          new Uint8Array(await fs.readFile(path.join(runtime.workspaceRoot, sourcePath)))
        )
        return {
          inserted,
          updated,
          duplicated,
          records,
          slideCount: getSlides(presentation).length
        }
      },
      assert: async (result, runtime) => {
        const updatedSlides = (result.updated.postWriteReadback as { slides: Array<JsonObject> })
          .slides
        const elements = updatedSlides[0]!.elements as Array<JsonObject>
        const table = elements.find((element) => element.type === 'table')
        const chart = elements.find((element) => element.type === 'chart')
        const formula = elements.find((element) => element.type === 'formula')
        runtime.assertThat(
          elements.some((element) => element.type === 'connector') &&
            (table?.details as { rows?: string[][] })?.rows?.[1]?.[1] === '24%' &&
            (chart?.details as { chartType?: string })?.chartType === 'line' &&
            formula?.latex === 'a^2+b^2=c^2' &&
            result.duplicated.slideCount === 2 &&
            Boolean(
              (result.duplicated.postWriteReadback as { slides?: unknown[] }).slides?.length
            ) &&
            result.records.length === 1 &&
            result.slideCount === 2,
          {
            name: 'ppt-professional-operations-round-trip',
            message: 'PPT 专业元素操作和页面复制应写入成功，并通过 postWriteReadback 回读。',
            data: result
          }
        )
      }
    })
  })
})
