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
import { collectStartedToolStringArgs, filterAiRunEventsByType, hasKbToolCall } from '../testUtils'

type DocxApplyOpsResult = {
  changedBlocks?: Array<{
    blockId?: string
    beforeText?: string
    afterText?: string
  }>
}

const hasExpectedRiskReportChanges = (changedBlocks: readonly DocxApplyOpsResult['changedBlocks'][number][]) =>
  changedBlocks.length === 2 &&
  changedBlocks.some(
    (block) =>
      block.blockId === 'b:1' &&
      /风险结论/.test(block.beforeText || '') &&
      /待跟进/.test(block.afterText || '')
  ) &&
  changedBlocks.some(
    (block) =>
      block.blockId === 'b:2' &&
      /负责人说明/.test(block.beforeText || '') &&
      /Alice/.test(block.afterText || '')
  )

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
        const openedSourcePaths = collectStartedToolStringArgs(result.events, 'docx_open', 'sourcePath')
        const latestDocxApplyOpsEvent = toolResults
          .filter((event) => event.toolName === 'docx_apply_ops')
          .at(-1)
        const docxApplyOps = (latestDocxApplyOpsEvent?.result?.data as DocxApplyOpsResult | undefined) || {}
        const changedBlocks = docxApplyOps.changedBlocks || []
        const kbEvidenceText = JSON.stringify(
          toolResults
            .filter((event) => event.toolName.startsWith('kb_'))
            .map((event) => event.outputPreview)
        )
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
        const deliveryText = `${result.output?.summary || ''}\n${result.output?.deliveryMarkdown || ''}`.trim()

        runtime.assertThat(
          result.output?.status === 'completed' &&
            toolNames.includes('terminal_run_command') &&
            hasKbToolCall(result.events) &&
            openedSourcePaths.includes(result.workspaceSeed.templatePath) &&
            toolNames.includes('docx_open') &&
            toolNames.includes('docx_apply_ops') &&
            toolNames.includes('docx_render_preview'),
          {
            name: 'human-live-risk-report-runs-required-tool-chain',
            message: 'live human complex case 应通过 terminal、KB 与 docx 真实工具链完成周报草稿任务。',
            data: {
              toolNames,
              summary: result.output?.summary,
              deliveryMarkdown: result.output?.deliveryMarkdown,
              artifacts: result.output?.artifacts
            }
          }
        )

        runtime.assertThat(docxArtifacts.length > 0 && templateUnchanged, {
          name: 'human-live-risk-report-produces-preview-without-overwriting-template',
          message: 'live human complex case 应生成 preview/draft artifact，且原模板文件不能被覆盖。',
          data: {
            toolNames,
            templatePath: result.workspaceSeed.templatePath,
            artifacts: result.output?.artifacts
          }
        })

        runtime.assertThat(hasExpectedRiskReportChanges(changedBlocks), {
          name: 'human-live-risk-report-updates-risk-and-owner-placeholders',
          message: 'live human complex case 应把模板中的风险结论和负责人说明两处占位符替换为实际内容。',
          data: {
            changedBlocks,
            toolNames
          }
        })

        runtime.assertThat(
          kbEvidenceText.includes('Weekly Risk Summary.md') &&
            kbEvidenceText.includes('Owner Note.md') &&
            deliveryText.length > 0,
          {
            name: 'human-live-risk-report-delivery-is-present-and-backed-by-evidence',
            message: 'live human complex case 应给出最终交付，且运行过程中应实际命中支撑本次填写的两份资料。',
            data: {
              openedSourcePaths,
              kbEvidenceText,
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
  }, 600_000)
})
