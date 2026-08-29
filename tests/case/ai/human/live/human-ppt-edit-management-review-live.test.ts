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

const FIXTURE_PATH = 'tests/fixtures/workspace/ppt/emcation-brand-proposal.pptx' as const
const WORKSPACE_RELATIVE = 'ppt/emcation-brand-proposal.pptx'

const PROTECTED_MARKERS = [
  'Agenda About the brand Market analysis',
  'Be the go-to destination for modern, meaningful escapes'
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
        description: '在既有富品牌提案 PPT 上做真实编辑并交付可解析文件。',
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
              `请更新工作区中的 ${WORKSPACE_RELATIVE}：`,
              '1）在封面后新增一页「Executive summary」，概括品牌定位与核心策略；',
              '2）把封面 Presenter 从 Kendall Collins 改为 李然；',
              '3）把 About 页里 Established in 2002 改为 Established in 2015；',
              'Agenda 页和 Quote 页（The vision / go-to destination）保持完全不动。',
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
              /Established in 2015/iu.test(joined) &&
              /Executive summary/iu.test(joined) &&
              !/Kendall Collins/iu.test(joined) &&
              !/Established in 2002/iu.test(joined) &&
              result.afterSlideCount === result.beforeSlideCount + 1 &&
              result.outsideShapeCount <= result.beforeOutsideShapeCount &&
              result.validationErrors === 0 &&
              artifacts.length === 1,
            {
              name: 'human-live-ppt-edit-delivers-a-valid-reviewed-deck',
              message:
                'live human 应完成品牌提案 PPT 更新：新增摘要页、改 Presenter 与成立年份，并保持 Agenda/Quote 页不变、产出可解析。',
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
