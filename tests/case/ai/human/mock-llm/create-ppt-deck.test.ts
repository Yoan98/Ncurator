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

const coverSlide = {
  type: 'insert_slide' as const,
  background: '#F4F0E8',
  elements: [
    {
      type: 'shape' as const,
      shape: 'roundRect' as const,
      bounds: { x: 50, y: 45, width: 860, height: 110 },
      style: { fill: '#17324D' }
    },
    {
      type: 'text' as const,
      text: '季度业务复盘',
      bounds: { x: 85, y: 68, width: 790, height: 60 },
      style: { color: '#FFFFFF', fontSize: 36, bold: true }
    },
    {
      type: 'text' as const,
      text: '增长引擎与下一步行动',
      bounds: { x: 85, y: 210, width: 790, height: 60 },
      style: { color: '#DCE8F1', fontSize: 18 }
    }
  ]
}

const detailSlide = {
  type: 'insert_slide' as const,
  background: '#FFFFFF',
  elements: [
    {
      type: 'text' as const,
      text: '下一步行动',
      bounds: { x: 70, y: 50, width: 820, height: 55 },
      style: { color: '#17324D', fontSize: 36, bold: true }
    },
    {
      type: 'text' as const,
      text: '缩短反馈周期，集中投入增长引擎。',
      bounds: { x: 80, y: 150, width: 800, height: 60 },
      style: { color: '#333333', fontSize: 18 }
    }
  ]
}

describe('ai human mock-llm backend', () => {
  it('create-ppt-deck', async () => {
    await runBackendCase({
      caseId: 'create-ppt-deck',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 human 学习 PPT 读写技能、按元素规格创建并读回 PPT，最终只交付一次文件。',
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
                  args: { sourcePath, ...coverSlide },
                  summary: '创建封面页'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'ppt_edit',
                  args: { sourcePath, ...detailSlide },
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
                output: buildCompleteTaskDecision({
                  summary: 'PPT 已创建并检查。',
                  deliveryMarkdown: '已创建两页季度业务复盘 PPT。'
                })
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '创建两页季度业务复盘 PPT，并确认最终页面数量。'
        })
        const presentation = await loadPresentation(new Uint8Array(await fs.readFile(sourcePath)))

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
              'human 应通过 ppt_edit 创建页面、ppt_read_outline 回读，并在 run 结束时只交付一个 PPT 文件记录。',
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
