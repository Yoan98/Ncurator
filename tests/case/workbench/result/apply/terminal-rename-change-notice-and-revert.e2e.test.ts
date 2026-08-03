import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getWorkbenchLocator,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForApplyEntry,
  waitForWorkbenchAiRunCompletion,
  waitForWorkbenchApplyRecordStatus,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'terminal-rename-change-notice-and-revert'
const BEFORE_NAME = 'workbench-preview.md'
const AFTER_NAME = 'workbench-preview-renamed.md'

describe('workbench result e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'result',
        groups: ['apply'],
        description: '真实 AI 使用终端重命名文件后，验证扫描记录、重命名说明和确认回退。',
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
          const beforePath = path.join(setup.workspace.rootPath, BEFORE_NAME)
          const afterPath = path.join(setup.workspace.rootPath, AFTER_NAME)
          const beforeBytes = await fs.readFile(beforePath)
          const startedAtMs = Date.now()

          await sendWorkbenchMessage(
            page,
            `请只使用 terminal_run，在工作区根目录执行 mv ${BEFORE_NAME} ${AFTER_NAME}。不要修改文件内容，完成后确认新文件名存在。`
          )
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            setup.env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.8)

          const applyEntry = await waitForApplyEntry(page)
          const applyEntryText = ((await applyEntry.textContent()) || '').trim()
          await applyEntry.click()
          const notice = getWorkbenchLocator(page, workbenchSelectors.applyChangeNotice)
          await notice.waitFor({ state: 'visible', timeout: 30_000 })
          const noticeText = ((await notice.textContent()) || '').trim()
          const oldExistsAfterRename = await fs
            .access(beforePath)
            .then(() => true)
            .catch(() => false)
          const renamedBytes = await fs.readFile(afterPath)

          await getWorkbenchLocator(page, workbenchSelectors.applyRevertButton).click()
          await page.getByText('回退这次修改？').waitFor({ state: 'visible' })
          const confirmText = ((await page.locator('.ant-modal').last().textContent()) || '').trim()
          await getWorkbenchLocator(page, workbenchSelectors.applyRevertConfirmButton).click()
          await waitForWorkbenchApplyRecordStatus(page, 'reverted')

          const restoredBytes = await fs.readFile(beforePath)
          const renamedExistsAfterRevert = await fs
            .access(afterPath)
            .then(() => true)
            .catch(() => false)

          return {
            applyEntryText,
            noticeText,
            confirmText,
            oldExistsAfterRename,
            renamedBytesUnchanged: renamedBytes.equals(beforeBytes),
            restoredBytesUnchanged: restoredBytes.equals(beforeBytes),
            renamedExistsAfterRevert,
            terminalCalls: evidence.events.filter(
              (event) => event.type === 'tool_call_started' && event.toolName === 'terminal_run'
            ).length
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.applyEntryText.includes(AFTER_NAME) &&
              result.noticeText.includes('本次修改了文件名') &&
              result.noticeText.includes(BEFORE_NAME) &&
              result.noticeText.includes(AFTER_NAME) &&
              result.noticeText.includes('文件内容没有变化') &&
              !result.noticeText.includes('没有专用预览稿') &&
              result.confirmText.includes('回退这次修改？') &&
              result.confirmText.includes('文件将恢复到这次修改发生前的状态') &&
              !result.oldExistsAfterRename &&
              result.renamedBytesUnchanged &&
              result.restoredBytesUnchanged &&
              !result.renamedExistsAfterRevert &&
              result.terminalCalls >= 1,
            {
              name: 'workbench-terminal-rename-notice-revert-real',
              message:
                'AI 通过终端重命名文件后，应保留命令级修改记录、展示前后文件名，并在确认后恢复原文件名。',
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
