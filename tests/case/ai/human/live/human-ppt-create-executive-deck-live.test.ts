import { assertRunFileReviews } from '../../../../harness/backend/fileReviewAssertions'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  findShapesOutsideCanvas,
  getSlideText,
  getSlides,
  getSlideShapes,
  getShapeBoundsResolved,
  hasShapeText,
  isTableShape,
  loadPresentation,
  validatePresentation
} from 'pptx-kit'
import {
  findPptTableOverflows,
  renderPptSlideSvg
} from '../../../../../src/main/services/ai/human/tools/ppt/textLayout'
import { describe, it } from 'vitest'
import { createAiServiceTestRunner } from '../../../../harness/backend/aiServiceHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const FILE_NAME = 'q2-executive-briefing.pptx'

describe('ai human live ppt create backend', () => {
  it('human-ppt-create-executive-deck-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-ppt-create-executive-deck-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '从零创建一份可开会使用的 16:9 管理层汇报 PPT。',
        fixtures: [],
        runMode: 'single',
        execute: async (runtime) => {
          const sourcePath = path.join(runtime.workspaceRoot, FILE_NAME)
          const eventOffset = runtime.eventCollector.snapshot().length
          const output = await (
            await createAiServiceTestRunner(runtime, {
              userInput: [
                `请直接在工作区创建“${FILE_NAME}”，做一份可给管理层开会用的 16:9 汇报，约 5–6 页：`,
                '封面、执行摘要、关键 KPI、交付或业务趋势图、风险与负责人、下一步。',
                '内容自拟但要像真实业务（含中文人名、日期和具体数字），版式专业可读。',
                '完成后自检文件可正常打开。'
              ].join('')
            })
          ).run()
          await assertRunFileReviews(runtime, output)
          const bytes = await fs.readFile(sourcePath)
          const presentation = await loadPresentation(new Uint8Array(bytes))
          const texts = getSlides(presentation).map((slide) => getSlideText(slide))
          const tableLayoutProblems: { slideIndex: number; text: string; cellIndex?: number }[] = []
          for (const [slideIndex, slide] of getSlides(presentation).entries()) {
            const shapes = getSlideShapes(slide)
            const tables = shapes.filter(isTableShape)
            if (!tables.length) continue
            const svg = await renderPptSlideSvg(presentation, slide)
            for (const table of tables) {
              const bounds = getShapeBoundsResolved(presentation, table)
              const overlaps = shapes
                .filter((shape) => !isTableShape(shape) && hasShapeText(shape))
                .filter((shape) => {
                  const other = getShapeBoundsResolved(presentation, shape)
                  return (
                    bounds.x < other.x + other.w &&
                    bounds.x + bounds.w > other.x &&
                    bounds.y < other.y + other.h &&
                    bounds.y + bounds.h > other.y
                  )
                })
              tableLayoutProblems.push(
                ...findPptTableOverflows(presentation, table, svg).map((overflow) => ({
                  slideIndex: slideIndex + 1,
                  ...overflow
                })),
                ...overlaps.map(() => ({
                  slideIndex: slideIndex + 1,
                  text: '表格与其他文字框重叠'
                }))
              )
            }
          }
          return {
            output,
            events: runtime.eventCollector.snapshot().slice(eventOffset),
            slideCount: texts.length,
            texts,
            tableLayoutProblems,
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
          const artifacts = (result.output.finalArtifacts || []).filter(
            (artifact) => artifact.kind === 'file' && artifact.capability === 'ppt'
          )
          const joined = result.texts.join('\n')
          runtime.assertThat(
            result.output.status === 'completed' &&
              toolNames.includes('ppt_edit') &&
              result.slideCount >= 5 &&
              result.slideCount <= 8 &&
              /执行摘要|executive summary/iu.test(joined) &&
              /风险|risk/iu.test(joined) &&
              /下一步|next|action/iu.test(joined) &&
              result.outsideShapeCount === 0 &&
              result.validationErrors === 0 &&
              result.tableLayoutProblems.length === 0 &&
              artifacts.length === 1,
            {
              name: 'human-live-ppt-create-delivers-usable-executive-deck',
              message:
                'live human 应从零创建可开会用的管理层汇报 PPT：页数合理、含摘要/风险/下一步、布局无越界、可解析并交付 artifact。',
              data: {
                toolNames,
                artifacts,
                slideCount: result.slideCount,
                texts: result.texts,
                tableLayoutProblems: result.tableLayoutProblems
              }
            }
          )
        }
      })
    })
  }, 1_800_000)
})
