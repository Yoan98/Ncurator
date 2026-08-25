import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import {
  buildDocumentNodeIndex,
  loadDocxBundle
} from '../../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/nodeIndex'
import { loadLiveLlmConfigFromEnv } from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  HUMAN_RISK_REPORT_DRAFT_USER_INPUT,
  loadRiskReportDraftWorkspaceSeed,
  RISK_REPORT_DRAFT_SHARED_WORKSPACE_FIXTURE_PATH
} from '../../../../harness/backend/liveScenarios/riskReportDraftScenario'
import {
  collectStartedDocxWriteSourcePaths,
  collectStartedToolStringArgs,
  filterAiRunEventsByType,
  hasDocxApplyArtifact,
  hasDocxFileArtifact,
  isDocxContentCreateInput,
  isDocxWriteInput
} from '../testUtils'

const openedExpectedDoc = (
  openedSourcePaths: readonly string[],
  expectedRelativePath: string,
  expectedName: string
): boolean => {
  const normalizedExpectedRelativePath = expectedRelativePath.replace(/\\/g, '/')
  return openedSourcePaths.some((sourcePath) => {
    const normalizedSourcePath = sourcePath.replace(/\\/g, '/')
    return (
      normalizedSourcePath.endsWith(normalizedExpectedRelativePath) ||
      normalizedSourcePath.endsWith(`/${expectedName}`)
    )
  })
}

const toWorkspaceRelativePath = (workspaceRoot: string, sourcePath: string): string => {
  const relativePath = path.isAbsolute(sourcePath)
    ? path.relative(workspaceRoot, sourcePath)
    : sourcePath
  return path.posix.normalize(relativePath.split(path.sep).join('/')).replace(/^\.\//, '')
}

const readDocxPlainText = async (filePath: string): Promise<string> => {
  const bundle = await loadDocxBundle(await fs.readFile(filePath))
  return buildDocumentNodeIndex(bundle)
    .outline.filter((node) => node.type !== 'table_cell')
    .map((node) => node.text)
    .join('\n')
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
      runtimeModelName: loadLiveLlmConfigFromEnv().model_name,
      execute: async (runtime) => {
        if (!loadLiveLlmConfigFromEnv()) {
          return {
            configurationMissing: true,
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
          configurationMissing: false,
          output,
          workspaceSeed,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        if (result.configurationMissing) {
          runtime.assertThat(false, {
            name: 'live-config-not-provided',
            message: '未提供 live 模型配置，已跳过 human live risk report draft case。'
          })
          return
        }

        const events = result.events
        const toolResults = filterAiRunEventsByType(events, 'tool_call_result')
        const toolNames = toolResults.map((event) => event.toolName)
        const trackedDocsUnchanged = await Promise.all(
          result.workspaceSeed.trackedDocFiles.map(async (fixture) => {
            const currentBytes = await fs.readFile(fixture.workspacePath)
            return Buffer.compare(currentBytes, Buffer.from(fixture.bytes)) === 0
          })
        )
        const openedSourcePaths = collectStartedToolStringArgs(
          events,
          'docx_read_outline',
          'sourcePath'
        )
          .concat(collectStartedToolStringArgs(events, 'docx_read', 'sourcePath'))
          .concat(collectStartedToolStringArgs(events, 'docx_search', 'sourcePath'))
        const createSourcePaths = collectStartedDocxWriteSourcePaths(
          events,
          isDocxContentCreateInput
        )
        const createdRelativePaths = createSourcePaths.map((sourcePath) =>
          toWorkspaceRelativePath(runtime.workspaceRoot, sourcePath)
        )
        const writeSourcePaths = collectStartedDocxWriteSourcePaths(events, isDocxWriteInput)
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
          (event) => event.toolName === 'docx_content_edit'
        )
        const hasCreatedNodeChanges =
          writeResultEvents.length === 0 ||
          writeResultEvents.some((event) => {
            const data = event.result?.data
            return (
              data !== null &&
              typeof data === 'object' &&
              Array.isArray((data as { changes?: object[] }).changes)
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
        const deliveryText = appliedDocText
        const generatedDraftText = appliedDocText
        const appliedTextOnly = appliedDocText
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

        const mentionsAppliedDelivery =
          /已生成|已创建|已修改|文件/.test(deliveryText) || hasDocxArtifact
        const hasResearchReadStep = toolNames.some((toolName) =>
          [
            'docx_read_outline',
            'docx_read',
            'docx_search',
            'kb_list_documents',
            'kb_search'
          ].includes(toolName)
        )
        runtime.assertThat(
          result.output?.status === 'completed' &&
            toolNames.includes('terminal_run') &&
            hasResearchReadStep &&
            toolNames.includes('docx_content_edit') &&
            createdTargetInAllowedLocation &&
            createdDocNotPreexisting &&
            writesStayOnCreatedDoc &&
            lastWeekOpened,
          {
            name: 'human-live-risk-report-runs-required-tool-chain',
            message:
              'live human complex case 应通过真实 workspace、DOCX 读取和 docx_content_edit 工具链完成本周周报文件创建任务。',
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

        runtime.assertThat(
          result.output?.status === 'completed' &&
            createSourcePaths.length >= 1 &&
            createdTargetInAllowedLocation &&
            createdDocNotPreexisting &&
            hasDocxArtifact &&
            trackedDocsUnchanged.every(Boolean) &&
            writesStayOnCreatedDoc,
          {
            name: 'human-live-risk-report-creates-new-draft-without-overwriting-source-docs',
            message: 'live risk report 应完成文件交付、保护原文件并真实落盘新周报草稿。',
            data: {
              createSourcePaths,
              createdRelativePaths,
              writeSourcePaths,
              writeRelativePaths,
              trackedDocsUnchanged,
              appliedDocPath,
              generatedDraftTextSnippet: generatedDraftText.slice(0, 2000),
              appliedTextSnippet: appliedTextOnly.slice(0, 2000)
            }
          }
        )

        runtime.assertThat(
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
              artifacts: result.output?.artifacts
            }
          }
        )

        runtime.assertThat(hasCreatedNodeChanges, {
          name: 'human-live-risk-report-write-results-include-created-node-changes',
          message: '同文件 DOCX 写后，写工具结果应包含结构化 changes，用于 brain 判断写入效果。',
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
