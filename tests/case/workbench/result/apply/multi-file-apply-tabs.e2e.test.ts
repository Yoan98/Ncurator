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
  it('multi-file-apply-tabs', async () => {
    await runE2ECase({
      caseId: 'multi-file-apply-tabs',
      domain: 'workbench',
      suite: 'result',
      groups: ['apply'],
      description: '同一轮 AI 修改多个文件时，assistant turn 和右侧工作区保留全部入口与 tab。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        await runtime.step({
          name: 'run-multi-apply-fixture',
          message: '触发同一轮多文件 apply fixture。',
          run: async () => {
            await seedWorkbenchReadyState(page)
            await sendWorkbenchMessage(page, '[e2e:chat-multi-apply] 修改两个 docx 文件')
            await waitForLatestAssistantFinalAnswer(page)
            await waitForApplyEntry(page)
          }
        })

        const applyEntryCount = await page
          .locator(`[data-testid^="${workbenchSelectors.assistantTurnApplyPrefix}-"]`)
          .count()

        await runtime.step({
          name: 'open-first-apply-entry',
          message: '打开第一个修改文件入口。',
          run: async () => {
            await page
              .locator(`[data-testid^="${workbenchSelectors.assistantTurnApplyPrefix}-"]`)
              .first()
              .click()
            await getWorkbenchLocator(page, workbenchSelectors.applyPanel).waitFor({
              state: 'visible'
            })
          }
        })
        const tabsTextBefore =
          (await getWorkbenchLocator(page, workbenchSelectors.applyTabs).textContent()) || ''

        await runtime.step({
          name: 'switch-second-tab',
          message: '在右侧修改文件工作区切换第二个文件 tab。',
          run: async () => {
            await getWorkbenchLocator(page, workbenchSelectors.applyTabs)
              .getByText('e2e-apply-b.docx')
              .click()
          }
        })
        const panelTextAfterSwitch = (await page.locator('body').textContent()) || ''
        const tabsTextAfter =
          (await getWorkbenchLocator(page, workbenchSelectors.applyTabs).textContent()) || ''

        return {
          applyEntryCount,
          tabsTextBefore,
          panelTextAfterSwitch,
          tabsTextAfter
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.applyEntryCount === 2, {
          name: 'assistant-turn-keeps-all-apply-entries',
          message:
            '同一轮任务生成的多个修改记录都应出现在同一 assistant turn 的修改文件列表中，对齐 WB-APPLY-005-AC1。',
          data: result
        })

        await runtime.assertThat(
          result.tabsTextBefore.includes('e2e-apply-a.docx') &&
            result.tabsTextBefore.includes('e2e-apply-b.docx'),
          {
            name: 'apply-workspace-keeps-all-file-tabs',
            message:
              '同一轮多文件场景下，右侧修改文件工作区应显示一文件一 tab，并保留全部入口，对齐 WB-PANEL-003-AC2、WB-APPLY-001-AC2。',
            data: result
          }
        )

        await runtime.assertThat(
          result.panelTextAfterSwitch.includes('e2e-apply-b.docx') &&
            result.tabsTextAfter.includes('e2e-apply-a.docx'),
          {
            name: 'switching-tabs-loads-corresponding-record',
            message:
              '点击不同修改记录入口或切换不同文件 tab 时，右侧应加载对应修改记录且不丢失其他文件入口，对齐 WB-APPLY-005-AC2、WB-APPLY-005-AC3。',
            data: result
          }
        )
      }
    })
  }, WORKBENCH_LONG_E2E_TIMEOUT_MS)
})
