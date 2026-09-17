import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForWorkbenchAiRunCompletion,
  waitForWorkbenchApplyRecordStatus,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'terminal-update-delete-change-and-revert'
const UPDATE_FILE = 'workbench-preview.md'
const DELETE_FILE = 'human-input.txt'
const MARKER = 'cedar-terminal-update-552'

const buildTerminalMutationPrompt = (workspaceRoot: string): string => {
  if (process.platform === 'win32') {
    // 单条命令内先切到工作区再改文件：追踪 cwd 依赖可解析的前导 Set-Location，
    // 且 Windows 会话每次 terminal_run 都从用户主目录新建，不能依赖跨调用 cwd。
    const command = [
      `Set-Location -LiteralPath '${workspaceRoot}'`,
      `Add-Content -LiteralPath '${UPDATE_FILE}' -Value "\`n${MARKER}" -Encoding utf8`,
      `Remove-Item -LiteralPath '${DELETE_FILE}' -Force`
    ].join('; ')
    return `请只使用一次 terminal_run，原样执行以下 PowerShell 命令（不要改写、不要拆成多条、不要使用其他工具）：${command}。完成后确认 ${UPDATE_FILE} 已追加「${MARKER}」且 ${DELETE_FILE} 已删除。`
  }
  const command = [
    `cd '${workspaceRoot}'`,
    `printf '\\n${MARKER}' >> '${UPDATE_FILE}'`,
    `rm -f '${DELETE_FILE}'`
  ].join('; ')
  return `请只使用一次 terminal_run，原样执行以下命令（不要改写、不要拆成多条、不要使用其他工具）：${command}。完成后确认 ${UPDATE_FILE} 已追加「${MARKER}」且 ${DELETE_FILE} 已删除。`
}

describe('workbench result e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'result',
        groups: ['apply'],
        description: '真实 AI 使用终端修改文本内容并删除文件后，验证行级 Diff 预览、删除说明和两类回退。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID
          })
          const updatePath = path.join(setup.workspace.rootPath, UPDATE_FILE)
          const deletePath = path.join(setup.workspace.rootPath, DELETE_FILE)
          const updateBeforeBytes = await fs.readFile(updatePath)
          const deleteBeforeBytes = await fs.readFile(deletePath)
          const startedAtMs = Date.now()

          await sendWorkbenchMessage(page, buildTerminalMutationPrompt(setup.workspace.rootPath))
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            setup.env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.8)
          if (evidence.fileArtifactCount < 1) {
            throw new Error(
              `terminal mutation produced no file_artifact (count=${String(evidence.fileArtifactCount)}); tracking cwd likely missed the workspace`
            )
          }

          const updateEntry = getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.assistantTurnApplyPrefix
          )
            .filter({ hasText: UPDATE_FILE })
            .first()
          const deleteEntry = getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.assistantTurnApplyPrefix
          )
            .filter({ hasText: DELETE_FILE })
            .first()
          await updateEntry.waitFor({ state: 'visible' })
          await deleteEntry.waitFor({ state: 'visible' })
          const updateEntryText = ((await updateEntry.textContent()) || '').trim()
          const deleteEntryText = ((await deleteEntry.textContent()) || '').trim()
          const updateAppliedBytes = await fs.readFile(updatePath, 'utf-8')
          const deleteExistsAfterRun = await fs
            .access(deletePath)
            .then(() => true)
            .catch(() => false)

          await updateEntry.click()
          const diffViewer = getWorkbenchLocator(page, workbenchSelectors.textDiffViewer)
          await diffViewer.waitFor({ state: 'visible', timeout: 30_000 })
          const diffText = ((await diffViewer.textContent()) || '').trim()
          await getWorkbenchLocator(page, workbenchSelectors.applyRevertButton).click()
          await page.getByText('回退这次修改？').waitFor({ state: 'visible' })
          await getWorkbenchLocator(page, workbenchSelectors.applyRevertConfirmButton).click()
          await waitForWorkbenchApplyRecordStatus(page, 'reverted')
          const updateRevertedBytes = await fs.readFile(updatePath)

          await deleteEntry.click()
          const deleteNotice = getWorkbenchLocator(page, workbenchSelectors.applyChangeNotice)
          await deleteNotice.waitFor({ state: 'visible', timeout: 30_000 })
          const deleteNoticeText = ((await deleteNotice.textContent()) || '').trim()
          await getWorkbenchLocator(page, workbenchSelectors.applyRevertButton).click()
          await page.getByText('回退这次修改？').waitFor({ state: 'visible' })
          await getWorkbenchLocator(page, workbenchSelectors.applyRevertConfirmButton).click()
          await waitForWorkbenchApplyRecordStatus(page, 'reverted')
          const deleteRestoredBytes = await fs.readFile(deletePath)

          return {
            updateEntryText,
            deleteEntryText,
            updateAppliedBytes,
            deleteExistsAfterRun,
            diffText,
            updateRevertedToBaseline: updateRevertedBytes.equals(updateBeforeBytes),
            deleteNoticeText,
            deleteRestoredToBaseline: deleteRestoredBytes.equals(deleteBeforeBytes),
            terminalCalls: evidence.events.filter(
              (event) => event.type === 'tool_call_started' && event.toolName === 'terminal_run'
            ).length,
            fileArtifactCount: evidence.fileArtifactCount
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.fileArtifactCount >= 1 &&
              result.updateEntryText.includes(UPDATE_FILE) &&
              result.deleteEntryText.includes(DELETE_FILE) &&
              result.updateAppliedBytes.includes(MARKER) &&
              result.deleteExistsAfterRun === false &&
              result.diffText.includes(MARKER) &&
              !result.diffText.includes('没有专用预览稿') &&
              result.updateRevertedToBaseline &&
              result.deleteNoticeText.includes('本次删除了该文件') &&
              result.deleteRestoredToBaseline &&
              result.terminalCalls >= 1,
            {
              name: 'workbench-terminal-update-delete-revert-real',
              message:
                'AI 通过终端修改文本和删除文件后，应生成两条可回退记录；修改记录展示行级 Diff 且回退恢复原始 bytes，删除记录展示删除说明且回退恢复文件。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
