import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  findShapesOutsideCanvas,
  getSlideText,
  getSlides,
  loadPresentation,
  validatePresentation
} from 'pptx-kit'
import { describe, it } from 'vitest'
import { createPptToolHarness } from '../../../../harness/backend/aiToolHarness'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const FILE_NAME = 'management-review.pptx'

const hashFile = async (filePath: string): Promise<string> =>
  createHash('sha256').update(await fs.readFile(filePath)).digest('hex')

const slideHtml = (title: string, body: string, color: string): string =>
  `<section data-ppt-slide style="position:relative;width:1920px;height:1080px;background:#F8FAFC">
    <div style="position:absolute;left:96px;top:84px;width:1728px;height:120px;background:${color}"></div>
    <h1 style="position:absolute;left:140px;top:112px;width:1500px;height:80px;color:#FFFFFF;font-size:58px">${title}</h1>
    <p style="position:absolute;left:150px;top:310px;width:1520px;height:500px;color:#1F2937;font-size:36px">${body}</p>
  </section>`

const chartHtml = `<section data-ppt-slide style="position:relative;width:1920px;height:1080px;background:#FFFFFF">
  <h1 style="position:absolute;left:120px;top:90px;width:1500px;height:88px;color:#17324D;font-size:62px">Delivery trend</h1>
  <div data-pptx-chart="column" data-pptx-categories='["April","May","June"]' data-pptx-series='[{"name":"On-time delivery","values":[96,91,84]}]' style="position:absolute;left:180px;top:270px;width:1420px;height:600px"></div>
  <p style="position:absolute;left:180px;top:900px;width:1420px;height:60px;color:#334155;font-size:30px">Delivery performance has declined for three consecutive months.</p>
</section>`

const buildFixture = async (runtime: Parameters<typeof createPptToolHarness>[0]): Promise<void> => {
  const setup = createPptToolHarness(runtime)
  await setup.invoke('ppt_edit', {
    sourcePath: path.join(runtime.workspaceRoot, FILE_NAME),
    actions: [
      { type: 'insert_slide', html: slideHtml('Q2 management review', 'Cover page. Do not change.', '#17324D') },
      { type: 'insert_slide', html: slideHtml('Operating metrics', 'Revenue and retention are on plan. Do not change.', '#0F766E') },
      { type: 'insert_slide', html: chartHtml },
      {
        type: 'insert_slide',
        html: slideHtml(
          'Delivery risk',
          'Highest priority: core integration is delayed. Owner: Wang Min. Commitment: July 8. Impact: East China launch.',
          '#B45309'
        )
      },
      { type: 'insert_slide', html: slideHtml('Action plan', 'Finish integration by July 8 and report daily status.', '#7C3AED') }
    ]
  })
}

describe('ai human live ppt backend', () => {
  it('human-ppt-read-management-risk-review-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-ppt-read-management-risk-review-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        requiresVisionModel: true,
        description: '审阅管理层汇报 PPT 并以对话方式给出风险简报，且不修改 PPT。',
        fixtures: [],
        runMode: 'single',
        execute: async (runtime) => {
          await buildFixture(runtime)
          const sourcePath = path.join(runtime.workspaceRoot, FILE_NAME)
          const beforeHash = await hashFile(sourcePath)
          const eventOffset = runtime.eventCollector.snapshot().length
          const output = await createHumanTestRunner(runtime, {}).run({
            taskId: runtime.taskId,
            userInput:
              '请为下周的领导层会议审阅 management-review.pptx，告诉我优先风险、负责人、期限、需要决策的事项以及交付趋势。简报前请先核对第 3 页的交付图表。不要修改演示文稿。'
          })
          return {
            output,
            beforeHash,
            afterHash: await hashFile(sourcePath),
            events: runtime.eventCollector.snapshot().slice(eventOffset)
          }
        },
        assert: async (result, runtime) => {
          const starts = filterAiRunEventsByType(result.events, 'tool_call_started')
          const toolNames = starts.map((event) => event.toolName)
          runtime.assertThat(
            result.output.status === 'completed' &&
              result.beforeHash === result.afterHash &&
              !toolNames.includes('ppt_edit') &&
              toolNames.some((name) => name.startsWith('ppt_read') || name === 'ppt_search'),
            {
              name: 'human-live-ppt-risk-review-uses-real-reading',
              message: 'The live model must read the deck and leave the source unchanged.',
              data: { toolNames }
            }
          )
        }
      })
    })
  }, 420_000)

  it('human-ppt-write-management-review-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-ppt-write-management-review-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '更新既有管理层汇报 PPT，并交付可解析、可读取的演示文稿。',
        fixtures: [],
        runMode: 'single',
        execute: async (runtime) => {
          await buildFixture(runtime)
          const sourcePath = path.join(runtime.workspaceRoot, FILE_NAME)
          const before = await loadPresentation(new Uint8Array(await fs.readFile(sourcePath)))
          const protectedTexts = getSlides(before).slice(0, 2).map((slide) => getSlideText(slide))
          const eventOffset = runtime.eventCollector.snapshot().length
          const output = await createHumanTestRunner(runtime, {}).run({
            taskId: runtime.taskId,
            userInput:
              '请更新这份管理层汇报 PPT：新增一页执行摘要；把交付风险升级为最高优先级，负责人改为李然，期限改为 7 月 15 日，并把行动计划中的期限也同步更新。除这些改动外，其他内容保持原样不要改动。完成后检查文件可正常读取。'
          })
          const presentation = await loadPresentation(new Uint8Array(await fs.readFile(sourcePath)))
          return {
            output,
            events: runtime.eventCollector.snapshot().slice(eventOffset),
            protectedTexts,
            texts: getSlides(presentation).map((slide) => getSlideText(slide)),
            outsideShapeCount: getSlides(presentation).reduce(
              (count, slide) => count + findShapesOutsideCanvas(slide, presentation).length,
              0
            ),
            validationErrors: validatePresentation(presentation).filter((issue) => issue.severity === 'error').length
          }
        },
        assert: async (result, runtime) => {
          const starts = filterAiRunEventsByType(result.events, 'tool_call_started')
          const toolNames = starts.map((event) => event.toolName)
          const artifacts = (result.output.artifacts || []).filter(
            (artifact) => artifact.kind === 'file' && artifact.capability === 'ppt'
          )
          runtime.assertThat(
              result.output.status === 'completed' &&
              toolNames.some((name) => name.startsWith('ppt_read') || name === 'ppt_search') &&
              toolNames.includes('ppt_edit') &&
              result.protectedTexts.every((text) => result.texts.includes(text)) &&
              result.texts.some((text) => /执行摘要|executive summary/iu.test(text)) &&
              result.texts.some((text) => text.includes('李然')) &&
              result.texts.some((text) => /7\s*月\s*15|july\s*15/iu.test(text)) &&
              result.outsideShapeCount === 0 &&
              result.validationErrors === 0 &&
              artifacts.length === 1,
            {
              name: 'human-live-ppt-write-delivers-a-valid-reviewed-deck',
              message:
                'live human 应完成管理层评审 PPT 更新：新增摘要页、升级风险负责人与期限，并保持封面与指标页不变、产出可解析。',
              data: { toolNames, artifacts, texts: result.texts }
            }
          )
        }
      })
    })
  }, 420_000)
})
