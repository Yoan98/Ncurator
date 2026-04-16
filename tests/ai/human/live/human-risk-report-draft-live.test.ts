import path from 'node:path'
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
import {
  filterAiRunEventsByType,
  hasDraftFileArtifact,
  hasDraftReviewArtifact,
  hasKbToolCall
} from '../testUtils'

type DocxMutationResult = {
  changedBlocks?: Array<{
    blockId?: string
    beforeText?: string
    afterText?: string
  }>
}

const hasExpectedRiskReportChanges = (changedBlocks: readonly DocxMutationResult['changedBlocks'][number][]) =>
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

const openedExpectedTemplate = (
  openedSourcePaths: readonly string[],
  templatePath: string
): boolean => {
  const workspaceRoot = path.dirname(templatePath)
  return openedSourcePaths.some((sourcePath) => {
    if (sourcePath === templatePath) {
      return true
    }
    if (path.basename(sourcePath) === path.basename(templatePath)) {
      return true
    }
    return path.resolve(workspaceRoot, sourcePath) === templatePath
  })
}

describe('ai human live backend', () => {
  it('human-risk-report-draft-live', async () => {
    await runBackendCase({
      caseId: 'human-risk-report-draft-live',
      harnessMode: 'live',
      domain: 'ai',
      suite: 'human',
      groups: ['live'],
      description: '验证 live 模式下 human 会在真实长任务里串起模板定位、资料取证、docx 编辑与 confirm-copy 交付。',
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
        const openedSourcePaths = filterAiRunEventsByType(result.events, 'tool_call_started')
          .filter((event) => event.toolName.startsWith('docx_'))
          .map((event) => event.input.sourcePath)
          .filter((value): value is string => typeof value === 'string')
        const changedBlocks = toolResults
          .filter((event) => event.toolName === 'docx_text_edit')
          .flatMap((event) => {
            const docxMutation = (event.result?.data as DocxMutationResult | undefined) || {}
            return docxMutation.changedBlocks || []
          })
        const kbEvidenceText = JSON.stringify(
          toolResults
            .filter((event) => event.toolName.startsWith('kb_'))
            .map((event) => event.outputPreview)
        )
        const templateUnchanged = await hasUnchangedFileBytes(
          result.workspaceSeed.templatePath,
          result.workspaceSeed.originalTemplateBytes
        )
        const deliveryText = `${result.output?.summary || ''}\n${result.output?.deliveryMarkdown || ''}`.trim()

        runtime.assertThat(
          result.output?.status === 'completed' &&
            toolNames.includes('workspace_run_command') &&
            hasKbToolCall(result.events) &&
            openedExpectedTemplate(openedSourcePaths, result.workspaceSeed.templatePath) &&
            toolNames.some((toolName) => toolName === 'docx_read' || toolName === 'docx_outline') &&
            toolNames.includes('docx_text_edit'),
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

        runtime.assertThat(templateUnchanged && deliveryText.length > 0, {
          name: 'human-live-risk-report-preserves-template-and-delivers-summary',
          message: 'live human complex case 应保留原模板文件，并给出最终修改说明。',
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
            deliveryText.length > 0 &&
            filterAiRunEventsByType(result.events, 'draft_review_ready').length >= 1 &&
            hasDraftReviewArtifact(result.output?.artifacts) &&
            hasDraftFileArtifact(result.output?.artifacts),
          {
            name: 'human-live-risk-report-delivery-is-backed-by-evidence-and-review-artifacts',
            message: 'live human complex case 应给出最终交付，并产出 draft review 与 confirm copy artifact。',
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
