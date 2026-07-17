import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import {
  buildBlockIndex,
  loadDocxBundle
} from '../../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/blockIndex'
import {
  loadLiveLlmConfigFromEnv,
  hasLiveLlmConfigInEnv
} from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  HUMAN_RISK_REPORT_DRAFT_USER_INPUT,
  loadRiskReportDraftWorkspaceSeed,
  RISK_REPORT_DRAFT_SHARED_WORKSPACE_FIXTURE_PATH
} from '../../../../harness/backend/liveScenarios/riskReportDraftScenario'
import {
  collectStartedDocxEditSourcePaths,
  collectStartedToolStringArgs,
  filterAiRunEventsByType,
  hasDocxApplyArtifact,
  hasDocxFileArtifact,
  isDocxEditCreateInput,
  isDocxEditWriteInput
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
  /财务接口人\s*Bob.*补齐付款材料(?:与附件映射说明)?，?并在复核前完成附件对齐/.test(text) ||
  /Bob.*(?:负责|本周内)?.*补齐付款材料/.test(text)

const normalizeAssertionText = (text: string): string => text.replace(/\s+/g, '')

const readDocxPlainText = async (filePath: string): Promise<string> => {
  const bundle = await loadDocxBundle(await fs.readFile(filePath))
  return buildBlockIndex(bundle.documentDom)
    .outline.filter((block) => block.type !== 'table_cell')
    .map((block) => block.text)
    .join('\n')
}

const hasRiskConclusionSemantics = (text: string, expectedRiskConclusion: string): boolean => {
  const normalizedText = normalizeAssertionText(text)
  const normalizedExpected = normalizeAssertionText(expectedRiskConclusion)
  return (
    normalizedText.includes(normalizedExpected) ||
    /最终合规签署完成前[^。]{0,40}(?:仍需|继续)(?:保持|持续)跟进/.test(normalizedText) ||
    /最终合规签署(?:尚未|仍未)[^。]{0,20}(?:闭环|完成)[^。]{0,40}风险状态(?:仍需|继续)?(?:保持|持续)?跟进/.test(
      normalizedText
    ) ||
    /合规签署(?:完整)?闭环前[^。]{0,40}风险(?:状态)?(?:仍需|继续)?(?:保持|持续)?跟进/.test(
      normalizedText
    ) ||
    /(?:确认事项|确认环节|最终确认)[^。]{0,28}(?:待闭环|未闭环|未完成)[^。]{0,28}(?:保持|继续|持续)跟进/.test(
      normalizedText
    )
  )
}

const hasPendingRiskStateSemantics = (text: string): boolean => {
  const normalizedText = normalizeAssertionText(text)
  return (
    /最终合规签署(?:尚未|仍未|还未)(?:闭环|完成)/.test(normalizedText) ||
    /最终合规签署[^。]{0,40}(?:仍存在|尚有|还有).{0,24}(?:确认项|确认环节|未闭环|未完成)/.test(
      normalizedText
    ) ||
    /最终合规签署[^。]{0,40}(?:确认事项|确认环节).{0,24}(?:待闭环|未闭环|未完成|待确认)/.test(
      normalizedText
    ) ||
    /正式复核窗口[^。]{0,24}(?:尚未|仍未|还未)(?:完全)?关闭/.test(normalizedText) ||
    /不具备对外使用.{0,12}(?:风险已解除|全部完成)/.test(normalizedText) ||
    /(?:最后一份|最终)合规附件[^。]{0,28}(?:仍在|尚在)(?:内部)?确认流程/.test(normalizedText) ||
    /(?:最后一份|最终)合规附件[^。]{0,28}(?:尚未|未完成).{0,20}(?:最终确认|确认)/.test(
      normalizedText
    ) ||
    /(?:仍有|尚有)一项合规附件[^。]{0,28}(?:确认流程|尚未.{0,12}闭环)/.test(normalizedText)
  )
}

const hasAffirmativeForbiddenRiskConclusion = (text: string): boolean => {
  const normalizedText = normalizeAssertionText(text)
  const forbiddenPhrases = ['风险已解除', '全部完成', '风险已完全收口']
  const negationHints = [
    '不使用',
    '不要',
    '不建议',
    '不宜使用',
    '避免',
    '不应',
    '禁用',
    '不提前',
    '不写成',
    '不提前写成',
    '不直接写成',
    '不直接使用',
    '不直接下',
    '不要提前写成'
  ]
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
        '验证 live 模式下 human 会在真实长任务里串起多源工作文档取证、新建周报 docx 与文件交付。',
      fixtures: [RISK_REPORT_DRAFT_SHARED_WORKSPACE_FIXTURE_PATH],
      runMode: 'single',
      runtimeModelName: hasLiveLlmConfigInEnv() ? loadLiveLlmConfigFromEnv().model_name : null,
      execute: async (runtime) => {
        if (!hasLiveLlmConfigInEnv()) {
          return {
            skipped: true,
            output: null,
            events: []
          }
        }

        const workspaceSeed = await loadRiskReportDraftWorkspaceSeed(runtime)
        await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv())

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

        const events = result.events
        const toolResults = filterAiRunEventsByType(events, 'tool_call_result')
        const toolNames = toolResults.map((event) => event.toolName)
        const deliveryText = String(result.output?.deliveryMarkdown || '').trim()
        const trackedDocsUnchanged = await Promise.all(
          result.workspaceSeed.trackedDocFiles.map(async (fixture) => {
            const currentBytes = await fs.readFile(fixture.workspacePath)
            return Buffer.compare(currentBytes, Buffer.from(fixture.bytes)) === 0
          })
        )
        const openedSourcePaths = collectStartedToolStringArgs(events, 'docx_read_outline', 'sourcePath')
          .concat(collectStartedToolStringArgs(events, 'docx_read_blocks', 'sourcePath'))
          .concat(collectStartedToolStringArgs(events, 'docx_search', 'sourcePath'))
        const createSourcePaths = collectStartedDocxEditSourcePaths(events, isDocxEditCreateInput)
        const createdRelativePaths = createSourcePaths.map((sourcePath) =>
          toWorkspaceRelativePath(runtime.workspaceRoot, sourcePath)
        )
        const writeSourcePaths = collectStartedDocxEditSourcePaths(events, isDocxEditWriteInput)
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
            (sourcePath) =>
              sourcePath.startsWith('工作/') || sourcePath === path.basename(sourcePath)
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
          (event) => event.toolName === 'docx_edit'
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
        const docxFileArtifact = result.output?.artifacts?.find(
          (artifact) => artifact.kind === 'file' && artifact.capability === 'docx'
        )
        const hasDocxArtifact = hasDocxFileArtifact(result.output?.artifacts)
        let appliedDocText = ''
        const appliedDocPath = docxFileArtifact?.kind === 'file' ? docxFileArtifact.path : undefined
        if (appliedDocPath) {
          appliedDocText = await readDocxPlainText(appliedDocPath)
        }
        const generatedDraftText = `${appliedDocText}\n${deliveryText}`
        const appliedTextOnly = appliedDocText || deliveryText
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
          appliedTextOnly,
          result.workspaceSeed.expectedRiskConclusion
        )
        const pendingRiskStateSatisfied = hasPendingRiskStateSemantics(appliedTextOnly)
        const hasForbiddenAffirmativeConclusion =
          hasAffirmativeForbiddenRiskConclusion(appliedTextOnly)
        const nextStepSatisfied = hasNextStepSemantics(
          generatedDraftText,
          result.workspaceSeed.expectedNextStep
        )
        const mentionsAppliedDelivery =
          /已生成|已创建|已修改|文件/.test(deliveryText) || hasDocxArtifact
        const hasResearchReadStep = toolNames.some((toolName) =>
          [
            'docx_read_outline',
            'docx_read_blocks',
            'docx_search',
            'kb_list_documents',
            'kb_search'
          ].includes(toolName)
        )
        const scoreParts = {
          createdDraft:
            createSourcePaths.length >= 1 &&
            createdTargetInAllowedLocation &&
            createdDocNotPreexisting &&
            hasDocxArtifact
              ? 2
              : 0,
          sourceSafety: trackedDocsUnchanged.every(Boolean) && writesStayOnCreatedDoc ? 2 : 0,
          pendingRisk: riskConclusionSatisfied || pendingRiskStateSatisfied ? 2 : 0,
          ownershipAndActions: ownerSummarySatisfied && nextStepSatisfied ? 2 : 0,
          cautiousConclusion: !hasForbiddenAffirmativeConclusion ? 2 : 0
        }
        const score = Object.values(scoreParts).reduce((total, value) => total + value, 0)

        runtime.assertThat(
          result.output?.status === 'completed' &&
            toolNames.includes('terminal_run') &&
            hasResearchReadStep &&
            toolNames.includes('docx_edit') &&
            createdTargetInAllowedLocation &&
            createdDocNotPreexisting &&
            writesStayOnCreatedDoc &&
            lastWeekOpened,
          {
            name: 'human-live-risk-report-runs-required-tool-chain',
            message:
              'live human complex case 应通过真实 workspace/检索读取/docx_edit(create_document) 工具链完成本周周报文件创建任务。',
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

        runtime.assertThat(score > 8, {
          name: 'human-live-risk-report-creates-new-draft-without-overwriting-source-docs',
          message:
            'live risk report 按 10 分制评估文件交付、原文件安全、风险状态、负责人动作和谨慎结论，得分必须严格超过 8 分。',
          data: {
            score,
            scoreParts,
            createSourcePaths,
            createdRelativePaths,
            writeSourcePaths,
            writeRelativePaths,
            trackedDocsUnchanged,
            appliedDocPath,
            expectedRiskConclusion: result.workspaceSeed.expectedRiskConclusion,
            riskConclusionSatisfied,
            pendingRiskStateSatisfied,
            hasForbiddenAffirmativeConclusion,
            ownerSummarySatisfied,
            nextStepSatisfied,
            generatedDraftTextSnippet: generatedDraftText.slice(0, 2000),
            appliedTextSnippet: appliedTextOnly.slice(0, 2000),
            deliveryMarkdown: result.output?.deliveryMarkdown
          }
        })

        runtime.assertThat(
          /负责人/.test(deliveryText) &&
            mentionsAppliedDelivery &&
            filterAiRunEventsByType(events, 'file_artifact').some(
              (event) => event.capability === 'docx' && Boolean(event.applyId)
            ) &&
            hasDocxApplyArtifact(result.output?.artifacts) &&
            hasDocxArtifact,
          {
            name: 'human-live-risk-report-delivery-is-backed-by-evidence-and-apply-artifacts',
            message:
              'live human complex case 应给出最终交付，并产出已修改文件 artifact 与 applyId。',
            data: {
              toolNames,
              createSourcePaths,
              deliveryMarkdown: result.output?.deliveryMarkdown,
              artifacts: result.output?.artifacts
            }
          }
        )

        runtime.assertThat(hasPostWriteReadback, {
          name: 'human-live-risk-report-write-results-include-post-write-readback',
          message:
            '同文件 docx 写后，写工具结果应包含 postWriteReadback，用于 brain 判断写入效果。',
          data: {
            writeResultEvents,
            createdRelativePaths,
            writeRelativePaths
          }
        })

        runtime.assertThat(!appliedDocText.includes('review_artifact_invalid_generated'), {
          name: 'human-live-risk-report-committed-doc-hides-generated-discarded-draft',
          message: '最终写回文档不应包含 generated 中间废稿的删除项痕迹。',
          data: {
            appliedDocTextSnippet: appliedDocText.slice(0, 2000)
          }
        })
      }
    })
  })
})
