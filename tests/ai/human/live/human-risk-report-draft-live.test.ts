import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { loadDocxBundle } from '../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/blockIndex'
import { XMLSerializer } from '@xmldom/xmldom'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  HUMAN_RISK_REPORT_DRAFT_USER_INPUT,
  loadRiskReportDraftWorkspaceSeed,
  RISK_REPORT_DRAFT_SHARED_WORKSPACE_FIXTURE_PATH
} from '../../../harness/backend/liveScenarios/riskReportDraftScenario'
import {
  collectStartedToolStringArgs,
  filterAiRunEventsByType,
  hasDraftFileArtifact,
  hasFileReviewArtifact
} from '../testUtils'

const openedExpectedDoc = (
  openedSourcePaths: readonly string[],
  expectedRelativePath: string,
  expectedName: string
): boolean =>
  openedSourcePaths.some(
    (sourcePath) =>
      sourcePath.endsWith(expectedRelativePath) || sourcePath.endsWith(`/${expectedName}`)
  )

const toWorkspaceRelativePath = (workspaceRoot: string, sourcePath: string): string => {
  const relativePath = path.isAbsolute(sourcePath)
    ? path.relative(workspaceRoot, sourcePath)
    : sourcePath
  return path.posix.normalize(relativePath.split(path.sep).join('/')).replace(/^\.\//, '')
}

const hasOwnerSummarySemantics = (text: string, expectedOwnerSummary: string): boolean =>
  text.includes(expectedOwnerSummary) || /最终复核窗口.*合规负责人\s*Alice.*牵头/.test(text)

const hasNextStepSemantics = (text: string, expectedNextStep: string): boolean =>
  text.includes(expectedNextStep) ||
  /财务接口人\s*Bob.*补齐付款材料(?:与附件映射说明)?，?并在复核前完成附件对齐/.test(
    text
  ) ||
  /Bob.*(?:负责|本周内)?.*补齐付款材料/.test(text)

const normalizeAssertionText = (text: string): string => text.replace(/\s+/g, '')

const hasRiskConclusionSemantics = (
  text: string,
  expectedRiskConclusion: string
): boolean => {
  const normalizedText = normalizeAssertionText(text)
  const normalizedExpected = normalizeAssertionText(expectedRiskConclusion)
  return (
    normalizedText.includes(normalizedExpected) ||
    /最终合规签署完成前[^。]{0,40}(?:仍需|继续)(?:保持|持续)跟进/.test(normalizedText)
  )
}

const hasPendingRiskStateSemantics = (text: string): boolean => {
  const normalizedText = normalizeAssertionText(text)
  return (
    /最终合规签署[^。]{0,40}(?:仍存在|尚有|还有).{0,24}(?:确认项|确认环节|未闭环|未完成)/.test(
      normalizedText
    ) ||
    /正式复核窗口[^。]{0,24}(?:尚未|仍未|还未)(?:完全)?关闭/.test(normalizedText) ||
    /不具备对外使用.{0,12}(?:风险已解除|全部完成)/.test(normalizedText) ||
    /(?:最后一份|最终)合规附件[^。]{0,28}(?:仍在|尚在)(?:内部)?确认流程/.test(normalizedText)
  )
}

const hasAffirmativeForbiddenRiskConclusion = (text: string): boolean => {
  const normalizedText = normalizeAssertionText(text)
  const forbiddenPhrases = ['风险已解除', '全部完成', '风险已完全收口']
  const negationHints = ['不使用', '不要', '不建议', '避免', '不应', '禁用']
  const sentenceBoundaryPattern = /[。；！？]/

  for (const phrase of forbiddenPhrases) {
    let index = normalizedText.indexOf(phrase)
    while (index !== -1) {
      const prefixText = normalizedText.slice(0, index)
      let sentenceStart = 0

      for (let i = prefixText.length - 1; i >= 0; i -= 1) {
        if (sentenceBoundaryPattern.test(prefixText[i] || '')) {
          sentenceStart = i + 1
          break
        }
      }

      const localPrefix = prefixText.slice(sentenceStart)
      if (!negationHints.some((hint) => localPrefix.includes(hint))) {
        return true
      }
      index = normalizedText.indexOf(phrase, index + phrase.length)
    }
  }

  return false
}

describe('ai human live backend', () => {
  it('human-risk-report-draft-live', async () => {
    await runBackendCase({
      caseId: 'human-risk-report-draft-live',
      harnessMode: 'live',
      domain: 'ai',
      suite: 'human',
      groups: ['live'],
      description:
        '验证 live 模式下 human 会在真实长任务里串起多源工作文档取证、新建周报 docx 与待确认稿交付。',
      fixtures: [RISK_REPORT_DRAFT_SHARED_WORKSPACE_FIXTURE_PATH],
      runMode: 'single',
      runtimeModelName: hasLiveLlmConfigInEnv() ? loadLiveLlmConfigFromEnv().model_name : null,
      execute: async (runtime) => {
        if (!hasLiveLlmConfigInEnv()) {
          return {
            skipped: true,
            output: null,
            indexedFiles: [],
            events: []
          }
        }

        const workspaceSeed = await loadRiskReportDraftWorkspaceSeed(runtime)
        await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv())
        const indexedFiles = await runtime.seedWorkspaceKb({
          mode: 'all-supported'
        })

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

        const events = result.events
        const toolResults = filterAiRunEventsByType(events, 'tool_call_result')
        const toolNames = toolResults.map((event) => event.toolName)
        const indexedSupportedFiles = result.indexedFiles.filter(
          (file) => file.supported && file.status === 'indexed'
        )
        const deliveryText = String(result.output?.deliveryMarkdown || '').trim()
        const trackedDocsUnchanged = await Promise.all(
          result.workspaceSeed.trackedDocFiles.map(async (fixture) => {
            const currentBytes = await fs.readFile(fixture.workspacePath)
            return Buffer.compare(currentBytes, Buffer.from(fixture.bytes)) === 0
          })
        )
        const openedSourcePaths = collectStartedToolStringArgs(events, 'docx_outline', 'sourcePath')
          .concat(collectStartedToolStringArgs(events, 'docx_read_blocks', 'sourcePath'))
          .concat(collectStartedToolStringArgs(events, 'docx_search', 'sourcePath'))
        const createSourcePaths = collectStartedToolStringArgs(events, 'docx_create', 'sourcePath')
        const createdRelativePaths = createSourcePaths.map((sourcePath) =>
          toWorkspaceRelativePath(runtime.workspaceRoot, sourcePath)
        )
        const writeSourcePaths = filterAiRunEventsByType(events, 'tool_call_started')
          .filter((event) =>
            [
              'docx_paragraph_edit',
              'docx_heading_edit',
              'docx_table_edit',
              'docx_text_edit',
              'docx_text_style_edit'
            ].includes(event.toolName)
          )
          .map((event) => event.input.sourcePath)
          .filter((value): value is string => typeof value === 'string')
        const writeRelativePaths = writeSourcePaths.map((sourcePath) =>
          toWorkspaceRelativePath(runtime.workspaceRoot, sourcePath)
        )
        const lastWeekOpened = openedExpectedDoc(
          openedSourcePaths,
          result.workspaceSeed.lastWeekReportRelativePath,
          path.basename(result.workspaceSeed.lastWeekReportRelativePath)
        )
        const relevantDocxOpened = result.workspaceSeed.relevantDocxRelativePaths.some(
          (relativePath) =>
            openedExpectedDoc(openedSourcePaths, relativePath, path.basename(relativePath))
        )
        const txtReads = result.workspaceSeed.relevantTxtRelativePaths.filter((relativePath) =>
          filterAiRunEventsByType(events, 'tool_call_started').some(
            (event) =>
              event.toolName === 'terminal_run' &&
              typeof event.input.command === 'string' &&
              event.input.command.includes(relativePath.replace('工作/', '工作/'))
          )
        )
        const createdTargetInAllowedLocation =
          createdRelativePaths.length >= 1 &&
          createdRelativePaths.every(
            (sourcePath) => sourcePath.startsWith('工作/') || sourcePath === path.basename(sourcePath)
          )
        const writesStayOnCreatedDoc =
          writeRelativePaths.length === 0 ||
          writeRelativePaths.every((sourcePath) => createdRelativePaths.includes(sourcePath))
        const createdDocNotPreexisting =
          createdRelativePaths.length >= 1 &&
          createdRelativePaths.every(
            (sourcePath) => !result.workspaceSeed.preexistingDocxRelativePaths.includes(sourcePath)
          )
        const writeResultEvents = filterAiRunEventsByType(events, 'tool_call_result').filter(
          (event) =>
            [
              'docx_create',
              'docx_paragraph_edit',
              'docx_heading_edit',
              'docx_table_edit',
              'docx_text_edit',
              'docx_text_style_edit'
            ].includes(event.toolName)
        )
        const hasPostWriteReadback =
          writeResultEvents.length === 0 ||
          writeResultEvents.some((event) => {
            const data = event.result?.data
            return (
              data !== null &&
              typeof data === 'object' &&
              Array.isArray(
                (data as { postWriteReadback?: { regions?: Array<object> } }).postWriteReadback
                  ?.regions
              )
            )
          })
        const reviewArtifact = result.output?.artifacts?.find(
          (artifact) => artifact.kind === 'draft_review'
        )
        const draftFileArtifact = result.output?.artifacts?.find(
          (artifact) =>
            artifact.kind === 'file' &&
            artifact.capability === 'docx' &&
            artifact.artifactRole === 'draft'
        )
        const hasDraftArtifact = hasDraftFileArtifact(result.output?.artifacts)
        let reviewXml = ''
        const draftArtifactPath =
          draftFileArtifact?.kind === 'file' ? draftFileArtifact.path : undefined
        if (draftArtifactPath) {
          const reviewBundle = await loadDocxBundle(
            await fs.readFile(draftArtifactPath)
          )
          reviewXml = new XMLSerializer().serializeToString(reviewBundle.documentDom)
        }
        const generatedDraftText = `${reviewXml}\n${deliveryText}`
        const draftTextOnly = reviewXml || deliveryText
        const evidenceText = `${generatedDraftText}\n${JSON.stringify(
          result.output?.artifacts || []
        )}`
        const referencesDocxEvidence =
          result.workspaceSeed.relevantDocxRelativePaths.some((relativePath) =>
            evidenceText.includes(path.basename(relativePath))
          ) ||
          evidenceText.includes(path.basename(result.workspaceSeed.lastWeekReportRelativePath)) ||
          /工作文档|所有工作|供应商补件说明|法务复核意见|客户周会纪要|交付合规同步记录/.test(
            evidenceText
          )
        const referencesTxtEvidence =
          result.workspaceSeed.relevantTxtRelativePaths.some((relativePath) =>
            evidenceText.includes(path.basename(relativePath))
          ) ||
          (txtReads.length >= 1 &&
            /工作文档|所有工作|材料|排期更新|对外口径确认|财务跟进/.test(evidenceText))
        const ownerSummarySatisfied = hasOwnerSummarySemantics(
          generatedDraftText,
          result.workspaceSeed.expectedOwnerSummary
        )
        const riskConclusionSatisfied = hasRiskConclusionSemantics(
          draftTextOnly,
          result.workspaceSeed.expectedRiskConclusion
        )
        const pendingRiskStateSatisfied = hasPendingRiskStateSemantics(draftTextOnly)
        const hasForbiddenAffirmativeConclusion =
          hasAffirmativeForbiddenRiskConclusion(draftTextOnly)
        const nextStepSatisfied = hasNextStepSemantics(
          generatedDraftText,
          result.workspaceSeed.expectedNextStep
        )
        const mentionsDraftDelivery =
          /待确认稿|草稿|待发版/.test(deliveryText) || hasDraftArtifact
        const hasResearchReadStep = toolNames.some((toolName) =>
          [
            'docx_outline',
            'docx_read_blocks',
            'docx_search',
            'kb_list_documents',
            'kb_search'
          ].includes(toolName)
        )

        runtime.assertThat(
          result.output?.status === 'completed' &&
            toolNames.includes('terminal_run') &&
            hasResearchReadStep &&
            toolNames.includes('docx_create') &&
            createdTargetInAllowedLocation &&
            createdDocNotPreexisting &&
            writesStayOnCreatedDoc &&
            lastWeekOpened,
          {
            name: 'human-live-risk-report-runs-required-tool-chain',
            message:
              'live human complex case 应通过真实 workspace/检索读取/docx_create 工具链完成本周周报待确认稿任务。',
            data: {
              toolNames,
              hasResearchReadStep,
              openedSourcePaths,
              createSourcePaths,
              createdRelativePaths,
              writeSourcePaths,
              writeRelativePaths,
              txtReads,
              relevantDocxOpened,
              referencesDocxEvidence,
              referencesTxtEvidence,
              deliveryMarkdown: result.output?.deliveryMarkdown,
              artifacts: result.output?.artifacts
            }
          }
        )

        runtime.assertThat(deliveryText.length > 0, {
          name: 'human-live-risk-report-delivers-final-markdown',
          message: 'live human complex case 应给出最终修改说明。',
          data: {
            toolNames,
            artifacts: result.output?.artifacts
          }
        })

        runtime.assertThat(indexedSupportedFiles.length > 0, {
          name: 'human-live-risk-report-indexes-all-supported-workspace-files',
          message: 'risk report live case 应在运行前至少把部分已支持文件索引进 KB。',
          data: {
            indexedSupportedFiles
          }
        })

        runtime.assertThat(
          trackedDocsUnchanged.every(Boolean) &&
            createSourcePaths.length >= 1 &&
            (riskConclusionSatisfied || pendingRiskStateSatisfied) &&
            ownerSummarySatisfied &&
            nextStepSatisfied &&
            !hasForbiddenAffirmativeConclusion,
          {
            name: 'human-live-risk-report-creates-new-draft-without-overwriting-source-docs',
            message:
              'live human complex case 应新建本周周报待确认稿，不覆盖模板或既有工作 docx；只要风险状态仍明确未收口、负责人和后续动作成立，且不输出正向绝对收口表述，即视为对用户诉求负责。',
            data: {
              createSourcePaths,
              createdRelativePaths,
              writeSourcePaths,
              writeRelativePaths,
              trackedDocsUnchanged,
              draftArtifactPath,
              expectedRiskConclusion: result.workspaceSeed.expectedRiskConclusion,
              riskConclusionSatisfied,
              pendingRiskStateSatisfied,
              hasForbiddenAffirmativeConclusion,
              ownerSummarySatisfied,
              nextStepSatisfied,
              generatedDraftTextSnippet: generatedDraftText.slice(0, 2000),
              draftTextSnippet: draftTextOnly.slice(0, 2000),
              deliveryMarkdown: result.output?.deliveryMarkdown
            }
          }
        )

        runtime.assertThat(
          /负责人/.test(deliveryText) &&
            mentionsDraftDelivery &&
            filterAiRunEventsByType(events, 'draft_review_ready').length >= 1 &&
            hasFileReviewArtifact(result.output?.artifacts) &&
            hasDraftArtifact,
          {
            name: 'human-live-risk-report-delivery-is-backed-by-evidence-and-review-artifacts',
            message:
              'live human complex case 应给出最终交付，并产出 draft review 与待确认稿 artifact。',
            data: {
              toolNames,
              createSourcePaths,
              deliveryMarkdown: result.output?.deliveryMarkdown,
              artifacts: result.output?.artifacts
            }
          }
        )

        runtime.assertThat(
          hasPostWriteReadback,
          {
            name: 'human-live-risk-report-write-results-include-post-write-readback',
            message:
              '同文件 docx 写后，写工具结果应包含 postWriteReadback，用于 brain 判断写入效果。',
            data: {
              writeResultEvents,
              createdRelativePaths,
              writeRelativePaths
            }
          }
        )

        runtime.assertThat(!reviewXml.includes('review_artifact_invalid_generated'), {
          name: 'human-live-risk-report-review-hides-generated-discarded-draft',
          message: '最终 review 不应包含 generated 中间废稿的删除项痕迹。',
          data: {
            reviewXmlSnippet: reviewXml.slice(0, 2000)
          }
        })
      }
    })
  }, 900_000)
})
