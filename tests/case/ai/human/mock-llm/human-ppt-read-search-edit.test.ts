import fs from 'node:fs/promises'
import path from 'node:path'
import { getSlides, getSlideText, loadPresentation } from 'pptx-kit'
import { describe, it } from 'vitest'
import type { JsonObject } from '../../../../../src/shared/types'
import { createPptToolHarness } from '../../../../harness/backend/aiToolHarness'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  buildToolDecision,
  filterAiRunEventsByType
} from '../testUtils'

const seedSlide = {
  type: 'insert_slide' as const,
  background: '#FFFFFF',
  elements: [
    {
      type: 'text' as const,
      text: '季度复盘',
      bounds: { x: 140, y: 100, width: 1500, height: 110 },
      style: { fontSize: 36 }
    },
    {
      type: 'text' as const,
      text: '负责人：TBD',
      bounds: { x: 160, y: 300, width: 1450, height: 120 },
      style: { fontSize: 18 }
    }
  ]
}

describe('ai human mock-llm ppt backend', () => {
  it('human-ppt-read-search-edit', async () => {
    await runBackendCase({
      caseId: 'human-ppt-read-search-edit',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 human 对已有 PPT 读取、搜索、局部编辑并复读。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = path.join(runtime.workspaceRoot, 'existing-review.pptx')
        await createPptToolHarness(runtime).invoke<JsonObject>('ppt_edit', {
          sourcePath,
          ...seedSlide
        })
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
                  toolName: 'ppt_read_outline',
                  args: {
                    sourcePath,
                    ranges: [{ type: 'percent', fromPercent: 0, toPercent: 100 }]
                  },
                  summary: '读取页面概览'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'ppt_search',
                  args: { sourcePath, query: '负责人：TBD' },
                  summary: '定位待更新文本'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'ppt_edit',
                  args: {
                    sourcePath,
                    type: 'replace_text',
                    query: '负责人：TBD',
                    replace: '负责人：Alice'
                  },
                  summary: '更新负责人'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'ppt_search',
                  args: { sourcePath, query: '负责人：Alice' },
                  summary: '复读确认结果'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: 'PPT 已更新并确认。',
                  deliveryMarkdown: '负责人已更新为 Alice。'
                })
              }
            ]
          }
        })
        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '把已有季度复盘 PPT 的负责人改成 Alice，并确认。'
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
        const starts = filterAiRunEventsByType(result.events, 'tool_call_started')
        runtime.assertThat(
          result.output.status === 'completed' &&
            starts.some((event) => event.toolName === 'ppt_read_outline') &&
            starts.filter((event) => event.toolName === 'ppt_search').length >= 2 &&
            starts.filter((event) => event.toolName === 'ppt_edit').length >= 2 &&
            result.texts.some((text) => text.includes('负责人：Alice')) &&
            !result.texts.some((text) => text.includes('负责人：TBD')) &&
            result.output.artifacts.some(
              (artifact) => artifact.kind === 'file' && artifact.capability === 'ppt'
            ),
          {
            name: 'human-ppt-read-search-edit-chain',
            message: 'human 应对已有 PPT 完成读取、搜索、局部编辑、复读和交付。',
            data: result
          }
        )
      }
    })
  })
})
