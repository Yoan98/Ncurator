import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  HUMAN_RISK_REPORT_DRAFT_USER_INPUT,
  hasUnchangedFileBytes,
  loadRiskReportWorkspaceSeed,
  SHARED_WORKSPACE_FIXTURE_PATH
} from '../../../harness/backend/aiLiveTestData'
import {
  collectDocxWriteChangedBlocks,
  filterAiRunEventsByType,
  hasDocxWriteToolCall,
  hasDraftFileArtifact,
  hasFileReviewArtifact
} from '../testUtils'

const hasExpectedRiskReportChanges = (
  changedBlocks: readonly Array<{
    blockId?: string
    beforeText?: string
    afterText?: string
  }>
) =>
  changedBlocks.some(
    (block) => {
      const afterText = block.afterText || ''
      return (
        /本周风险结论：RISK_TODO/.test(block.beforeText || '') &&
        afterText.startsWith('本周风险结论：') &&
        !afterText.includes('RISK_TODO') &&
        !afterText.includes('已解除') &&
        /合规|待跟进/.test(afterText)
      )
    }
  ) &&
  changedBlocks.some(
    (block) => {
      const afterText = block.afterText || ''
      return (
        /负责人说明：OWNER_TODO/.test(block.beforeText || '') &&
        afterText.startsWith('负责人说明：') &&
        !afterText.includes('OWNER_TODO') &&
        afterText.includes('Alice')
      )
    }
  )

describe('ai human live backend', () => {
  it('human-risk-report-draft-live', async () => {
    await runBackendCase({
      caseId: 'human-risk-report-draft-live',
      harnessMode: 'live',
      domain: 'ai',
      suite: 'human',
      groups: ['live'],
      description: '验证 live 模式下 human 会在真实长任务里串起模板定位、资料取证、docx 编辑与待确认稿交付。',
      fixtures: [SHARED_WORKSPACE_FIXTURE_PATH],
      runMode: 'single',
      runtimeModelName: hasLiveLlmConfigInEnv('primary')
        ? loadLiveLlmConfigFromEnv('primary').model_name
        : null,
      execute: async (runtime) => {
        if (!hasLiveLlmConfigInEnv('primary')) {
          return {
            skipped: true,
            output: null,
            indexedFiles: [],
            events: []
          }
        }

        await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv('primary'))
        const indexedFiles = await runtime.seedWorkspaceKb({
          mode: 'all-supported'
        })
        const workspaceSeed = await loadRiskReportWorkspaceSeed(runtime)

        const runner = createHumanTestRunner(runtime)
        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: HUMAN_RISK_REPORT_DRAFT_USER_INPUT
        })

        return {
          skipped: false,
          output,
          indexedFiles,
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
        const indexedSupportedFiles = result.indexedFiles.filter(
          (file) => file.supported && file.status === 'indexed'
        )
        const changedBlocks = collectDocxWriteChangedBlocks(result.events)
        const deliveryText = `${result.output?.summary || ''}\n${result.output?.deliveryMarkdown || ''}`.trim()
        const sourceTemplateUnchanged = await hasUnchangedFileBytes(
          result.workspaceSeed.templatePath,
          result.workspaceSeed.originalTemplateBytes
        )

        runtime.assertThat(
          result.output?.status === 'completed' &&
            toolNames.includes('workspace_run_command') &&
            toolNames.some((toolName) => toolName === 'docx_read_blocks' || toolName === 'docx_outline') &&
            hasDocxWriteToolCall(result.events),
          {
            name: 'human-live-risk-report-runs-required-tool-chain',
            message: 'live human complex case 应通过 workspace 与 docx 真实工具链完成周报待确认稿任务。',
            data: {
              toolNames,
              summary: result.output?.summary,
              deliveryMarkdown: result.output?.deliveryMarkdown,
              artifacts: result.output?.artifacts
            }
          }
        )

        runtime.assertThat(deliveryText.length > 0, {
          name: 'human-live-risk-report-delivers-summary',
          message: 'live human complex case 应给出最终修改说明。',
          data: {
            toolNames,
            templatePath: result.workspaceSeed.templatePath,
            artifacts: result.output?.artifacts
          }
        })

        runtime.assertThat(indexedSupportedFiles.length === 8, {
          name: 'human-live-risk-report-indexes-all-supported-workspace-files',
          message: 'risk report live case 应在运行前把共享 workspace 中全部已支持文件索引进 KB。',
          data: {
            indexedSupportedFiles
          }
        })

        runtime.assertThat(
          hasExpectedRiskReportChanges(changedBlocks) && sourceTemplateUnchanged,
          {
          name: 'human-live-risk-report-updates-risk-and-owner-placeholders',
          message:
            'live human complex case 应把模板中的风险结论和负责人说明两处占位符替换为实际内容，且不覆盖原模板文件。',
          data: {
            changedBlocks,
            toolNames,
            templatePath: result.workspaceSeed.templatePath
          }
          }
        )

        runtime.assertThat(
          /(weekly-risk-summary\.md|project-milestones\.md|vendor-followup\.txt)/.test(
            deliveryText
          ) &&
            /owner-note\.md/.test(deliveryText) &&
            /风险结论/.test(deliveryText) &&
            /负责人/.test(deliveryText) &&
            /待确认稿/.test(deliveryText) &&
            filterAiRunEventsByType(result.events, 'draft_review_ready').length >= 1 &&
            hasFileReviewArtifact(result.output?.artifacts) &&
            hasDraftFileArtifact(result.output?.artifacts),
          {
            name: 'human-live-risk-report-delivery-is-backed-by-evidence-and-review-artifacts',
            message: 'live human complex case 应给出最终交付，并产出 draft review 与待确认稿 artifact。',
            data: {
              toolNames,
              changedBlocks,
              summary: result.output?.summary,
              deliveryMarkdown: result.output?.deliveryMarkdown,
              artifacts: result.output?.artifacts
            }
          }
        )
      }
    })
  }, 900_000)
})
