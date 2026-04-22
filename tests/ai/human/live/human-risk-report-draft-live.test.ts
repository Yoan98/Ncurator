import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import { XMLSerializer } from '@xmldom/xmldom'
import { loadDocxBundle } from '../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/blockIndex'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  HUMAN_RISK_REPORT_DRAFT_USER_INPUT,
  seedRiskReportKb,
  seedRiskReportWorkspace
} from '../../../harness/backend/aiLiveTestData'
import {
  collectDocxWriteChangedBlocks,
  filterAiRunEventsByType,
  hasDocxWriteToolCall,
  hasDraftFileArtifact,
  hasFileReviewArtifact,
  hasKbToolCall
} from '../testUtils'

const hasExpectedRiskReportChanges = (
  changedBlocks: readonly Array<{
    blockId?: string
    beforeText?: string
    afterText?: string
  }>
) =>
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
      description: '验证 live 模式下 human 会在真实长任务里串起模板定位、资料取证、docx 编辑与待确认稿交付。',
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
        const changedBlocks = collectDocxWriteChangedBlocks(result.events)
        const kbEvidenceText = JSON.stringify(
          toolResults
            .filter((event) => event.toolName.startsWith('kb_'))
            .map((event) => event.outputPreview)
        )
        const deliveryText = `${result.output?.summary || ''}\n${result.output?.deliveryMarkdown || ''}`.trim()
        const reviewArtifactPath =
          result.output?.artifacts?.find(
            (artifact) => artifact.kind === 'file' && artifact.capability === 'docx'
          )?.path || ''
        const reviewArtifactXml = reviewArtifactPath
          ? new XMLSerializer().serializeToString(
              (await loadDocxBundle(await fs.readFile(reviewArtifactPath))).documentDom
            )
          : ''

        runtime.assertThat(
          result.output?.status === 'completed' &&
            toolNames.includes('workspace_run_command') &&
            hasKbToolCall(result.events) &&
            toolNames.some((toolName) => toolName === 'docx_read_blocks' || toolName === 'docx_outline') &&
            hasDocxWriteToolCall(result.events),
          {
            name: 'human-live-risk-report-runs-required-tool-chain',
            message: 'live human complex case 应通过 terminal、KB 与 docx 真实工具链完成周报待确认稿任务。',
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
            hasFileReviewArtifact(result.output?.artifacts) &&
            hasDraftFileArtifact(result.output?.artifacts),
          {
            name: 'human-live-risk-report-delivery-is-backed-by-evidence-and-review-artifacts',
            message: 'live human complex case 应给出最终交付，并产出 draft review 与待确认稿 artifact。',
            data: {
              kbEvidenceText,
              toolNames,
              changedBlocks,
              summary: result.output?.summary,
              deliveryMarkdown: result.output?.deliveryMarkdown,
              artifacts: result.output?.artifacts
            }
          }
        )

        runtime.assertThat(
          reviewArtifactXml.includes('本周风险结论：RISK_TODO') &&
            reviewArtifactXml.includes('负责人说明：OWNER_TODO') &&
            reviewArtifactXml.includes('本周风险结论：在合规签署前，风险状态保持为“待跟进”。') &&
            reviewArtifactXml.includes('负责人说明：最终复核窗口由合规负责人 Alice 牵头。'),
          {
            name: 'human-live-risk-report-review-artifact-keeps-old-and-new-text',
            message: 'live human risk report case 的真实 review artifact 应同时保留旧占位符删除项和新内容新增项。',
            data: {
              reviewArtifactPath,
              reviewArtifactXmlSnippet: reviewArtifactXml.slice(0, 1600)
            }
          }
        )
      }
    })
  }, 600_000)
})
