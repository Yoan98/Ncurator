import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  HUMAN_RISK_REPORT_DRAFT_USER_INPUT,
  hasUnchangedFileBytes,
  seedRiskReportKb,
  seedRiskReportWorkspace
} from '../../../harness/backend/aiLiveTestData'
import { filterAiRunEventsByType } from '../testUtils'

describe('ai human live backend', () => {
  it('human-risk-report-draft-live', async () => {
    await runBackendCase({
      caseId: 'human-risk-report-draft-live',
      harnessMode: 'live',
      domain: 'ai',
      suite: 'human',
      groups: ['live'],
      description: '验证 live 模式下 human 会在真实长任务里串起模板定位、资料取证、docx 编辑与预览交付。',
      fixtures: [],
      runMode: 'single',
      runtimeModelName: hasLiveLlmConfigInEnv('primary')
        ? loadLiveLlmConfigFromEnv('primary').model_name
        : null,
      execute: async (runtime) => {
        if (!hasLiveLlmConfigInEnv('primary')) {
          return {
            skipped: true,
            output: null,
            events: []
          }
        }

        await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv('primary'))
        await seedRiskReportKb(runtime)
        const workspaceSeed = await seedRiskReportWorkspace(runtime)

        const runner = createHumanTestRunner(runtime)
        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: HUMAN_RISK_REPORT_DRAFT_USER_INPUT
        })

        return {
          skipped: false,
          output,
          workspaceSeed,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        if (result.skipped) {
          runtime.assertThat(true, {
            name: 'live-config-not-provided',
            message: '未提供 live 模型配置，已跳过 human live risk report draft case。'
          })
          return
        }

        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')
        const toolNames = toolResults.map((event) => event.toolName)
        const docxArtifacts =
          result.output?.artifacts?.filter(
            (artifact) =>
              artifact.kind === 'file' &&
              artifact.capability === 'docx' &&
              (artifact.artifactRole === 'preview' || artifact.artifactRole === 'draft')
          ) || []
        const templateUnchanged = await hasUnchangedFileBytes(
          result.workspaceSeed.templatePath,
          result.workspaceSeed.originalTemplateBytes
        )
        const deliveryText = `${result.output?.summary || ''}\n${result.output?.deliveryMarkdown || ''}`

        runtime.assertThat(
          result.output?.status === 'completed' &&
            toolNames.includes('terminal_run_command') &&
            toolNames.some((toolName) => toolName.startsWith('kb_')) &&
            toolNames.includes('docx_open') &&
            toolNames.includes('docx_apply_ops') &&
            toolNames.includes('docx_render_preview') &&
            docxArtifacts.length > 0 &&
            templateUnchanged &&
            /(待跟进|合规签署)/.test(deliveryText) &&
            /Alice/.test(deliveryText),
          {
            name: 'human-live-completes-risk-report-draft-through-real-tool-chain',
            message: 'live human complex case 应通过 terminal、KB 与 docx 真实工具链完成周报草稿任务。',
            data: {
              toolNames,
              summary: result.output?.summary,
              deliveryMarkdown: result.output?.deliveryMarkdown,
              artifacts: result.output?.artifacts
            }
          }
        )
      }
    })
  }, 600_000)
})
