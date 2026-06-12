import { writeFile } from 'node:fs/promises'
import { describe, it } from 'vitest'
import { workbenchSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LONG_E2E_TIMEOUT_MS,
  getWorkbenchLocator,
  seedWorkbenchReadyState,
  sendWorkbenchMessage,
  waitForApplyEntry,
  waitForLatestAssistantFinalAnswer
} from '../../../../harness/e2e/workbench'

describe('workbench result e2e', () => {
  it('docx-apply-force-revert-warning', async () => {
    await runE2ECase({
      caseId: 'docx-apply-force-revert-warning',
      domain: 'workbench',
      suite: 'result',
      groups: ['apply'],
      description: 'AI 写回后文件又被修改时，首次回退展示风险提示，确认后强制回退。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        await runtime.step({
          name: 'create-apply-record',
          message: '触发可回退的单文件 apply 记录并打开右侧工作区。',
          run: async () => {
            await seedWorkbenchReadyState(page)
            await sendWorkbenchMessage(page, '[e2e:chat-apply-revert-warning] 后续修改后回退')
            await waitForLatestAssistantFinalAnswer(page)
            await (await waitForApplyEntry(page)).click()
            await getWorkbenchLocator(page, workbenchSelectors.applyPanel).waitFor({
              state: 'visible'
            })
          }
        })

        const activeRecord = await page.evaluate(async () => {
          const sessions = await window.api.chatSessionList()
          const sessionId = sessions[0]?.id || ''
          const records = await window.api.aiFileChangeList({ sessionId })
          return records.items[0] || null
        })

        await runtime.step({
          name: 'modify-file-after-ai-write',
          message: '模拟用户在 AI 写回后又修改了目标文件。',
          run: async () => {
            if (!activeRecord?.path) throw new Error('missing active apply record path')
            await writeFile(activeRecord.path, 'user changed file after ai apply', 'utf8')
          }
        })

        await runtime.step({
          name: 'try-revert-and-confirm-force',
          message: '首次回退应出现风险提示，确认后再强制回退。',
          run: async () => {
            await getWorkbenchLocator(page, workbenchSelectors.applyRevertButton).click()
            const warningVisible = await page
              .getByText('恢复到本次修改前？')
              .waitFor({ state: 'visible', timeout: 1000 })
              .then(() => true)
              .catch(() => false)
            if (!warningVisible) return

            await page.getByRole('button', { name: '恢复到此前版本' }).click()
            await page
              .waitForFunction(() => document.body.innerText.includes('已回退本次修改'), undefined, {
                timeout: 1000
              })
              .catch(() => undefined)
          }
        })

        const bodyText = (await page.locator('body').textContent()) || ''
        const signals = await runtime.collectSignals()
        const revertCallCount = signals.ipcInvokeEntries.filter(
          (entry) => entry.name === 'aiFileChangeRevert'
        ).length
        const recordAfter = activeRecord?.id
          ? await page.evaluate(async (changeId) => {
              return await window.api.aiFileChangeGet({ changeId })
            }, activeRecord.id)
          : null

        return {
          bodyText,
          revertCallCount,
          recordStatus: recordAfter?.record?.status || null
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.bodyText.includes('恢复到本次修改前？'), {
          name: 'first-revert-shows-risk-warning',
          message:
            '检测到后续修改时，第一次回退不应静默覆盖，而应展示风险提示，对齐 WB-APPLY-004-AC1。',
          data: result
        })

        await runtime.assertThat(result.revertCallCount >= 2 && result.recordStatus === 'reverted', {
          name: 'force-revert-refreshes-state',
          message:
            '用户确认强制回退后，系统应恢复 checkpoint 或删除新建文件，并刷新右侧记录状态，对齐 WB-APPLY-004-AC2、WB-APPLY-004-AC3。',
          data: result
        })
      }
    })
  }, WORKBENCH_LONG_E2E_TIMEOUT_MS)
})
