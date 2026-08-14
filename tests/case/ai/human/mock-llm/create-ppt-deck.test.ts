import fs from 'node:fs/promises'
import path from 'node:path'
import { getSlides, getSlideText, loadPresentation } from 'pptx-kit'
import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  buildToolDecision,
  filterAiRunEventsByType
} from '../testUtils'

const coverHtml = `<section data-ppt-slide style="position:relative;width:1920px;height:1080px;background:#F4F0E8">
  <div style="position:absolute;left:96px;top:88px;width:1728px;height:904px;background:#17324D;border-radius:32px"></div>
  <h1 style="position:absolute;left:180px;top:300px;width:1500px;height:110px;color:#FFFFFF;font-size:72px">季度业务复盘</h1>
  <p style="position:absolute;left:184px;top:470px;width:1200px;height:90px;color:#DCE8F1;font-size:38px">增长引擎与下一步行动</p>
</section>`

const detailHtml = `<section data-ppt-slide style="position:relative;width:1920px;height:1080px;background:#FFFFFF">
  <h2 style="position:absolute;left:140px;top:100px;width:1500px;height:110px;color:#17324D;font-size:72px">下一步行动</h2>
  <p style="position:absolute;left:160px;top:300px;width:1450px;height:120px;color:#333333;font-size:38px">缩短反馈周期，集中投入增长引擎。</p>
</section>`

describe('ai human mock-llm backend', () => {
  it('create-ppt-deck', async () => {
    await runBackendCase({
      caseId: 'create-ppt-deck',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 human 学习 PPT 读写技能、批量创建并读回 PPT，mouth 只交付一次文件。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = path.join(runtime.workspaceRoot, 'mock-quarterly-review.pptx')
        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['ppt-read', 'ppt-write'],
                  summary: '学习 PPT 读写能力'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'ppt_edit',
                  args: {
                    sourcePath,
                    actions: [{ type: 'insert_slide', html: coverHtml }]
                  },
                  summary: '创建封面页'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'ppt_edit',
                  args: {
                    sourcePath,
                    actions: [{ type: 'insert_slide', html: detailHtml }]
                  },
                  summary: '新增行动页'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'ppt_read_outline',
                  args: {
                    sourcePath,
                    ranges: [{ type: 'percent', fromPercent: 0, toPercent: 100 }]
                  },
                  summary: '确认页面数量'
                })
              },
              {
                output: buildCompleteTaskDecision({ summary: 'PPT 已创建并检查。' })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: 'PPT 已创建并检查。',
                  deliveryMarkdown: '已创建两页季度业务复盘 PPT。'
                }
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '创建两页季度业务复盘 PPT，并确认最终页面数量。'
        })
        const presentation = await loadPresentation(
          new Uint8Array(await fs.readFile(sourcePath))
        )

        return {
          output,
          events: runtime.eventCollector.snapshot(),
          texts: getSlides(presentation).map((slide) => getSlideText(slide))
        }
      },
      assert: async (result, runtime) => {
        const startedTools = filterAiRunEventsByType(result.events, 'tool_call_started')
        const pptArtifacts = result.output.artifacts.filter(
          (artifact) => artifact.kind === 'file' && artifact.capability === 'ppt'
        )
        const fileEvents = filterAiRunEventsByType(result.events, 'file_artifact').filter(
          (event) => event.capability === 'ppt'
        )

        runtime.assertThat(
          result.output.status === 'completed' &&
            startedTools.filter((event) => event.toolName === 'ppt_edit').length === 2 &&
            startedTools.some((event) => event.toolName === 'ppt_read_outline') &&
            pptArtifacts.length === 1 &&
            Boolean(pptArtifacts[0]!.applyId) &&
            fileEvents.length === 1 &&
            result.texts.length === 2 &&
            result.texts.some((text) => text.includes('增长引擎')) &&
            result.texts.some((text) => text.includes('下一步行动')),
          {
            name: 'human-ppt-run-uses-two-tools-and-commits-once',
            message:
              'human 应通过 ppt_edit 批量创建、ppt_read_outline 回读，并在 run 结束时只交付一个 PPT 文件记录。',
            data: {
              tools: startedTools.map((event) => event.toolName),
              pptArtifacts,
              fileEvents,
              texts: result.texts
            }
          }
        )
      }
    })
  })
})
