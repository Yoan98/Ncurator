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
  createHash('sha256')
    .update(await fs.readFile(filePath))
    .digest('hex')

const slideSpec = (title: string, body: string, color: string) => ({
  type: 'insert_slide' as const,
  background: '#F8FAFC',
  elements: [
    {
      type: 'shape' as const,
      shape: 'rect' as const,
      bounds: { x: 96, y: 84, width: 1728, height: 120 },
      style: { fill: color }
    },
    {
      type: 'text' as const,
      text: title,
      bounds: { x: 140, y: 112, width: 1500, height: 80 },
      style: { color: '#FFFFFF', fontSize: 28 }
    },
    {
      type: 'text' as const,
      text: body,
      bounds: { x: 150, y: 310, width: 1520, height: 500 },
      style: { color: '#1F2937', fontSize: 18 }
    }
  ]
})

const chartSlide = {
  type: 'insert_slide' as const,
  background: '#FFFFFF',
  elements: [
    {
      type: 'text' as const,
      text: 'Delivery trend',
      bounds: { x: 120, y: 90, width: 1500, height: 88 },
      style: { color: '#17324D', fontSize: 32 }
    },
    {
      type: 'chart' as const,
      bounds: { x: 180, y: 270, width: 1420, height: 600 },
      chartType: 'column' as const,
      categories: ['April', 'May', 'June'],
      series: [{ name: 'On-time delivery', values: [96, 91, 84] }]
    },
    {
      type: 'text' as const,
      text: 'Delivery performance has declined for three consecutive months.',
      bounds: { x: 180, y: 900, width: 1420, height: 60 },
      style: { color: '#334155', fontSize: 16 }
    }
  ]
}

const buildFixture = async (runtime: Parameters<typeof createPptToolHarness>[0]): Promise<void> => {
  const setup = createPptToolHarness(runtime)
  const sourcePath = path.join(runtime.workspaceRoot, FILE_NAME)
  for (const spec of [
    slideSpec('Q2 management review', 'Cover page. Do not change.', '#17324D'),
    slideSpec('Operating metrics', 'Revenue and retention are on plan. Do not change.', '#0F766E'),
    chartSlide,
    slideSpec(
      'Delivery risk',
      'Highest priority: core integration is delayed. Owner: Wang Min. Commitment: July 8. Impact: East China launch.',
      '#B45309'
    ),
    slideSpec('Action plan', 'Finish integration by July 8 and report daily status.', '#7C3AED')
  ]) {
    await setup.invoke('ppt_edit', { sourcePath, ...spec })
  }
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
          const protectedTexts = getSlides(before)
            .slice(0, 2)
            .map((slide) => getSlideText(slide))
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
            validationErrors: validatePresentation(presentation).filter(
              (issue) => issue.severity === 'error'
            ).length
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
