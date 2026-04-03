import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../harness/backend/llmConfig'
import { createDirectorTestRunner } from '../../../harness/backend/directorHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  DIRECTOR_RISK_REPORT_DELIVERY_USER_INPUT,
  hasUnchangedFileBytes,
  seedRiskReportKb,
  seedRiskReportWorkspace
} from '../../../harness/backend/aiLiveTestData'
import {
  filterDirectorEventsByType,
  filterDirectorTaskEventsByStage
} from '../testUtils'

describe('ai director live backend', () => {
  it('director-risk-report-delivery-live', async () => {
    await runBackendCase({
      caseId: 'director-risk-report-delivery-live',
      harnessMode: 'live',
      domain: 'ai',
      suite: 'director',
      groups: ['live'],
      description: '验证 live 模式下 director 会把真实长任务拆解为资料整理、模板补全与最终交付。',
      fixtures: [],
      runMode: 'single',
      runtimeModelName: hasLiveLlmConfigInEnv('primary')
        ? loadLiveLlmConfigFromEnv('primary').model_name
        : null,
      execute: async (runtime) => {
        if (!hasLiveLlmConfigInEnv('primary')) {
          return {
            skipped: true,
            state: null,
            events: []
          }
        }

        await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv('primary'))
        await seedRiskReportKb(runtime)
        const workspaceSeed = await seedRiskReportWorkspace(runtime)

        const runner = createDirectorTestRunner(runtime)
        const state = await runner.run({
          userInput: DIRECTOR_RISK_REPORT_DELIVERY_USER_INPUT
        })

        return {
          skipped: false,
          state,
          workspaceSeed,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        if (result.skipped) {
          runtime.assertThat(true, {
            name: 'live-config-not-provided',
            message: '未提供 live 模型配置，已跳过 director live risk report delivery case。'
          })
          return
        }

        const toolResults = filterDirectorEventsByType(result.events, 'tool_call_result')
        const planCreatedEvents = filterDirectorEventsByType(result.events, 'plan_created')
        const planExecTaskStarts = filterDirectorTaskEventsByStage(
          result.events,
          'task_started',
          'director_plan_exec'
        )
        const synthesisTaskStarts = filterDirectorTaskEventsByStage(
          result.events,
          'task_started',
          'director_synthesis_human'
        )
        const toolNames = toolResults.map((event) => event.toolName)
        const finalArtifacts =
          result.state?.finalArtifacts?.filter(
            (artifact) =>
              artifact.kind === 'file' &&
              artifact.capability === 'docx' &&
              (artifact.artifactRole === 'preview' || artifact.artifactRole === 'draft')
          ) || []
        const templateUnchanged = await hasUnchangedFileBytes(
          result.workspaceSeed.templatePath,
          result.workspaceSeed.originalTemplateBytes
        )
        const finalDeliveryMarkdown = result.state?.finalDeliveryMarkdown || ''

        runtime.assertThat(
          result.state?.status === 'completed' &&
            planCreatedEvents.length === 1 &&
            planExecTaskStarts.length > 0 &&
            synthesisTaskStarts.length === 1 &&
            toolNames.includes('terminal_run_command') &&
            toolNames.some((toolName) => toolName.startsWith('kb_')) &&
            toolNames.includes('docx_open') &&
            toolNames.includes('docx_apply_ops') &&
            toolNames.includes('docx_render_preview') &&
            finalArtifacts.length > 0 &&
            templateUnchanged &&
            /(待跟进|合规签署)/.test(finalDeliveryMarkdown) &&
            /Alice/.test(finalDeliveryMarkdown),
          {
            name: 'director-live-completes-risk-report-delivery-through-plan-and-synthesis',
            message: 'live director complex case 应通过 plan、human 子任务与 synthesis 完成周报交付任务。',
            data: {
              toolNames,
              finalDeliveryMarkdown: result.state?.finalDeliveryMarkdown,
              finalArtifacts: result.state?.finalArtifacts,
              planCreated: planCreatedEvents
            }
          }
        )
      }
    })
  }, 600_000)
})
