import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  appendWorkbenchInputText,
  getWorkbenchLocator,
  insertWorkbenchReferenceToken,
  setupWorkbenchWithTempWorkspace,
  submitWorkbenchCurrentDraft,
  switchWorkbenchMode,
  waitForApplyEntry,
  waitForWorkbenchAiEvent,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'cancelled-run-keeps-artifact'
const BEFORE_TEXT = 'cedar-markdown-preview-442'
const AFTER_TEXT = 'cedar-cancelled-artifact-731'

describe('workbench run e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'run',
        groups: ['blocker'],
        description: '文件修改落地后取消运行，仍保留取消文案、文件卡片和差异预览。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            rootBindingMode: 'ipc'
          })
          const targetPath = path.join(setup.workspace.rootPath, 'workbench-preview.md')

          await switchWorkbenchMode(page, '大聪明')
          await insertWorkbenchReferenceToken(page, 'workbench-preview.md')
          await appendWorkbenchInputText(
            page,
            `请直接修改这个文件，使用 replaceAll 把唯一的 ${BEFORE_TEXT} 改成 ${AFTER_TEXT}。修改成功后必须调用 wait_time 等待 20 秒，再继续回复。`
          )
          await submitWorkbenchCurrentDraft(page)

          const runStarted = await waitForWorkbenchAiEvent(runtime, {
            name: 'cancelled_artifact_run_started',
            matches: (event) => event.type === 'run_started'
          })
          await waitForWorkbenchAiEvent(runtime, {
            name: 'artifact_before_cancel',
            matches: (event) =>
              event.type === 'file_artifact' &&
              event.runId === runStarted.runId &&
              event.fileName === 'workbench-preview.md'
          })

          const sendButton = getWorkbenchLocator(page, workbenchSelectors.sendButton)
          await page.waitForFunction(
            (testId) =>
              document
                .querySelector(`[data-testid="${testId}"]`)
                ?.getAttribute('aria-label')
                ?.includes('停止') ?? false,
            workbenchSelectors.sendButton
          )
          await sendButton.click()
          await waitForWorkbenchAiEvent(runtime, {
            name: 'run_cancelled_after_artifact',
            matches: (event) => event.type === 'run_cancelled' && event.runId === runStarted.runId
          })

          const applyEntry = await waitForApplyEntry(page)
          const applyEntryText = ((await applyEntry.textContent()) || '').trim()
          const assistantText = (
            (await page
              .locator('div[data-testid^="workbench-assistant-turn-"]')
              .last()
              .textContent()
              .catch(() => '')) || ''
          ).trim()
          const fileContent = await fs.readFile(targetPath, 'utf8')

          await applyEntry.click()
          await getWorkbenchLocator(page, workbenchSelectors.textDiffViewer).waitFor({
            state: 'visible',
            timeout: 30_000
          })

          return {
            assistantText,
            applyEntryText,
            fileContent,
            diffVisible: await getWorkbenchLocator(
              page,
              workbenchSelectors.textDiffViewer
            ).isVisible()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.assistantText.includes('已取消') &&
              !result.assistantText.includes('**') &&
              result.applyEntryText.includes('workbench-preview.md') &&
              result.fileContent.includes(AFTER_TEXT) &&
              !result.fileContent.includes(BEFORE_TEXT) &&
              result.diffVisible,
            {
              name: 'cancelled-run-keeps-applied-file-artifact',
              message: '文件修改成功后取消运行，取消文案、修改文件入口和差异预览都应保留。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
