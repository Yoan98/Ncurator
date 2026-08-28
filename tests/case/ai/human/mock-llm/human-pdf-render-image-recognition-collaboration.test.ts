import { describe, it } from 'vitest'
import { createPdfToolHarness } from '../../../../harness/backend/aiToolHarness'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  buildSelectedPdfFixtureReference,
  PDF_READING_FIXTURE_PATH
} from '../../../../harness/backend/aiLiveTestData'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  filterAiRunEventsByType
} from '../testUtils'

describe('ai human mock-llm backend', () => {
  it('human-pdf-read-image-collaboration', async () => {
    await runBackendCase({
      caseId: 'human-pdf-read-image-collaboration',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 PDF 页面图片路径可以通过 read_image 加入主模型上下文。',
      fixtures: [PDF_READING_FIXTURE_PATH],
      runMode: 'single',
      execute: async (runtime) => {
        const reference = buildSelectedPdfFixtureReference(runtime)
        const pdfHarness = createPdfToolHarness(runtime)
        const prepared = await pdfHarness.invoke<{
          pages: Array<{ pageImagePath: string }>
        }>('pdf_read_pages', {
          sourcePath: reference.absolutePath,
          selection: { type: 'page_numbers', pageNumbers: [9] }
        })
        await pdfHarness.release()
        const pageImagePath = prepared.pages[0]!.pageImagePath

        const runner = createHumanTestRunner(runtime, {
          selectedReferences: [reference],
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['pdf-read'],
                  summary: '补齐 PDF 阅读能力。'
                })
              },
              {
                output: {
                  thought: { next: '读取页面并把页面图片加入主模型上下文。' },
                  nextAction: {
                    action: 'hand',
                    calls: [
                      {
                        toolName: 'pdf_read_pages',
                        args: {
                          sourcePath: reference.absolutePath,
                          selection: { type: 'page_numbers', pageNumbers: [1, 9] }
                        }
                      },
                      { toolName: 'read_image', args: { paths: [pageImagePath] } }
                    ]
                  }
                }
              },
              {
                output: buildCompleteTaskDecision({
                  summary: 'PDF 文本和页面图片都已读取。',
                  deliveryMarkdown: '训练闭环和过度拟合页面已结合读取。'
                })
              }
            ]
          }
        })
        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '结合第1页文字和第9页图形说明训练闭环与过度拟合。'
        })
        return { output, events: runtime.eventCollector.snapshot(), pageImagePath }
      },
      assert: async (result, runtime) => {
        const starts = filterAiRunEventsByType(result.events, 'tool_call_started')
        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')

        runtime.assertThat(
          result.output.status === 'completed' &&
            starts.some((event) => event.toolName === 'pdf_read_pages') &&
            starts.some((event) => event.toolName === 'read_image') &&
            toolResults.some(
              (event) => event.toolName === 'read_image' && event.result?.ok === true
            ),
          {
            name: 'pdf-page-image-is-added-through-read-image',
            message: 'PDF 页面图片应通过 read_image 加入同一个主模型请求。',
            data: {
              toolNames: starts.map((event) => event.toolName),
              pageImagePath: result.pageImagePath
            }
          }
        )
      }
    })
  }, 30_000)
})
