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
    sourcePath: FILE_NAME,
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
        description: 'Reviews a management deck and gives the user a conversational risk briefing without changing the deck.',
        fixtures: [],
        runMode: 'single',
        execute: async (runtime) => {
          await buildFixture(runtime)
          const sourcePath = path.join(runtime.workspaceRoot, FILE_NAME)
          const beforeHash = await hashFile(sourcePath)
          const eventOffset = runtime.eventCollector.snapshot().length
          const output = await createHumanTestRunner(runtime, {
            allowedToolNames: ['ppt_read_outline', 'ppt_read_slides', 'ppt_search', 'ppt_read_visuals']
          }).run({
            taskId: runtime.taskId,
            userInput:
              'Review management-review.pptx for next week\'s leadership meeting. Tell me the priority risks, owners, deadlines, decisions needed, and delivery trend. Please also check the delivery chart on slide 3 before you brief me. Do not modify the presentation.'
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
        description: 'Updates an existing management deck and delivers a valid, readable presentation.',
        fixtures: [],
        runMode: 'single',
        execute: async (runtime) => {
          await buildFixture(runtime)
          const sourcePath = path.join(runtime.workspaceRoot, FILE_NAME)
          const before = await loadPresentation(new Uint8Array(await fs.readFile(sourcePath)))
          const protectedTexts = getSlides(before).slice(0, 2).map((slide) => getSlideText(slide))
          const eventOffset = runtime.eventCollector.snapshot().length
          const output = await createHumanTestRunner(runtime, {
            allowedToolNames: ['ppt_read_outline', 'ppt_read_slides', 'ppt_search', 'ppt_edit']
          }).run({
            taskId: runtime.taskId,
            userInput:
              'Update management-review.pptx for the leadership review: add an executive summary slide, escalate the delivery risk, change its owner to Li Ran and deadline to July 15, and update the matching action-plan deadline. Keep the cover and operating-metrics slides unchanged, then check the presentation is readable.'
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
              result.texts.length === 6 &&
              result.texts[0] === result.protectedTexts[0] &&
              result.texts.includes(result.protectedTexts[1]) &&
              result.texts.some(
                (text) =>
                  text.includes('Revenue and retention are on plan') &&
                  text.toLocaleLowerCase().includes('declined') &&
                  text.includes('Li Ran') &&
                  text.includes('July 15')
              ) &&
              result.texts.some((text) => text.includes('Li Ran') && text.includes('July 15')) &&
              result.outsideShapeCount === 0 &&
              result.validationErrors === 0 &&
              artifacts.length === 1,
            {
              name: 'human-live-ppt-write-delivers-a-valid-reviewed-deck',
              message: 'The live model must deliver the requested valid deck update.',
              data: { toolNames, artifacts }
            }
          )
        }
      })
    })
  }, 420_000)
})
