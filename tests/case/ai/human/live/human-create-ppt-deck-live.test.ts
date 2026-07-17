import fs from 'node:fs/promises'
import path from 'node:path'
import { getSlides, getSlideText, loadPresentation } from 'pptx-kit'
import { describe, it } from 'vitest'
import {
  hasLiveLlmConfigInEnv,
  loadLiveLlmConfigFromEnv
} from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const FILE_NAME = 'AI产品季度复盘.pptx'
const MARKERS = ['增长引擎', '下一步行动']

describe('ai human live backend', () => {
  it('human-create-ppt-deck-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-create-ppt-deck-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description:
          '验证真实 AI 使用 PPT 读写技能逐页创建可打开的两页 PPT，并在 run 结束后交付文件。',
        fixtures: [],
        runMode: 'single',
        runtimeModelName: hasLiveLlmConfigInEnv() ? loadLiveLlmConfigFromEnv().model_name : null,
        execute: async (runtime) => {
          if (!hasLiveLlmConfigInEnv())
            return { skipped: true, output: null, events: [], file: null }
          await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv())
          const runner = createHumanTestRunner(runtime, {
            allowedToolNames: ['ppt_read_outline', 'ppt_edit'],
            runtimeSettingsOverride: { llmStreamingMode: 'force_non_stream' }
          })
          const output = await runner.run({
            taskId: runtime.taskId,
            userInput: `请直接在工作区创建“${FILE_NAME}”。制作两页、16:9、简洁专业的产品季度复盘：第一页标题必须包含“${MARKERS[0]}”，第二页标题必须包含“${MARKERS[1]}”。必须使用 PPT 工具逐页创建，每次只生成一个页面 HTML，完成后确认文件已经写回。`
          })
          const filePath = path.join(runtime.workspaceRoot, FILE_NAME)
          const bytes = new Uint8Array(await fs.readFile(filePath))
          const presentation = await loadPresentation(bytes)
          return {
            skipped: false,
            output,
            events: runtime.eventCollector.snapshot(),
            file: {
              path: filePath,
              slideCount: getSlides(presentation).length,
              text: getSlides(presentation)
                .map((slide) => getSlideText(slide))
                .join('\n')
            }
          }
        },
        assert: async (result, runtime) => {
          if (result.skipped || !result.file) {
            runtime.assertThat(true, {
              name: 'live-config-not-provided',
              message: '未提供 live 模型配置，已跳过真实 AI 创建 PPT case。'
            })
            return
          }
          const startedTools = filterAiRunEventsByType(result.events, 'tool_call_started').map(
            (event) => event.toolName
          )
          const pptArtifacts = filterAiRunEventsByType(result.events, 'file_artifact').filter(
            (event) => event.capability === 'ppt' && Boolean(event.applyId)
          )
          runtime.assertThat(
            result.output?.status === 'completed' &&
              startedTools.filter((name) => name === 'ppt_edit').length >= 2 &&
              !startedTools.includes('terminal_run') &&
              result.file.slideCount === 2 &&
              MARKERS.every((marker) => result.file!.text.includes(marker)) &&
              pptArtifacts.length === 1 &&
              result.output.artifacts.some(
                (artifact) => artifact.kind === 'file' && artifact.capability === 'ppt'
              ),
            {
              name: 'human-live-creates-two-page-ppt-through-ppt-skill',
              message:
                '真实 AI 应通过 ppt_edit 逐页创建两页 PPT，最终写回一个可打开文件并产生 PPT 修改记录。',
              data: {
                output: result.output,
                file: result.file,
                startedTools,
                pptArtifacts
              }
            }
          )
        }
      })
    })
  })
})
