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
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const FIXTURE_PATH = 'tests/fixtures/workspace/品牌策略提案.pptx' as const
const WORKSPACE_RELATIVE = '品牌策略提案.pptx'

const PROTECTED_MARKERS = [
  '议程 关于品牌 市场分析',
  '成为现代、有意义出行的首选目的地'
] as const

describe('ai human live ppt edit backend', () => {
  it('human-ppt-edit-management-review-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-ppt-edit-management-review-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '在中文富品牌提案 PPT 上做真实编辑并交付可解析文件。',
        fixtures: [FIXTURE_PATH],
        runMode: 'single',
        execute: async (runtime) => {
          const sourcePath = path.join(runtime.workspaceRoot, WORKSPACE_RELATIVE)
          const before = await loadPresentation(new Uint8Array(await fs.readFile(sourcePath)))
          const beforeSlides = getSlides(before)
          const beforeSlideCount = beforeSlides.length
          const beforeOutsideShapeCount = beforeSlides.reduce(
            (count, slide) => count + findShapesOutsideCanvas(slide, before).length,
            0
          )
          const protectedTexts = beforeSlides
            .map((slide) => getSlideText(slide))
            .filter((text) =>
              PROTECTED_MARKERS.some((marker) => text.replace(/\s+/gu, ' ').includes(marker))
            )
          const eventOffset = runtime.eventCollector.snapshot().length
          const output = await createHumanTestRunner(runtime, {}).run({
            taskId: runtime.taskId,
            userInput: [
              `请更新工作区里的《${WORKSPACE_RELATIVE}》：`,
              '1）在封面后新增一页「执行摘要」，概括品牌定位与核心策略；',
              '2）把封面汇报人从「王晨」改为「李然」；',
              '3）把「关于品牌」页里的「成立于 2002 年」改为「成立于 2015 年」。',
              '「议程」页和「品牌愿景」页（含「成为现代、有意义出行的首选目的地」）保持完全不动。',
              '完成后确认文件可正常读取。'
            ].join('')
          })
          const presentation = await loadPresentation(new Uint8Array(await fs.readFile(sourcePath)))
          const texts = getSlides(presentation).map((slide) => getSlideText(slide))
          return {
            output,
            events: runtime.eventCollector.snapshot().slice(eventOffset),
            beforeSlideCount,
            afterSlideCount: texts.length,
            beforeOutsideShapeCount,
            protectedTexts,
            texts,
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
          const joined = result.texts.join('\n')
          runtime.assertThat(
            result.output.status === 'completed' &&
              toolNames.some((name) => name.startsWith('ppt_read') || name === 'ppt_search') &&
              toolNames.includes('ppt_edit') &&
              result.protectedTexts.length >= 2 &&
              result.protectedTexts.every((text) => result.texts.includes(text)) &&
              joined.includes('李然') &&
              /成立于 2015 年/u.test(joined) &&
              /执行摘要/u.test(joined) &&
              !/王晨/u.test(joined) &&
              !/成立于 2002 年/u.test(joined) &&
              result.afterSlideCount === result.beforeSlideCount + 1 &&
              result.outsideShapeCount <= result.beforeOutsideShapeCount &&
              result.validationErrors === 0 &&
              artifacts.length === 1,
            {
              name: 'human-live-ppt-edit-delivers-a-valid-reviewed-deck',
              message:
                'live human 应完成品牌提案 PPT 更新：新增摘要页、改汇报人与成立年份，并保持议程/愿景页不变、产出可解析。',
              data: {
                toolNames,
                artifacts,
                beforeSlideCount: result.beforeSlideCount,
                afterSlideCount: result.afterSlideCount,
                texts: result.texts
              }
            }
          )
        }
      })
    })
  }, 420_000)
})
