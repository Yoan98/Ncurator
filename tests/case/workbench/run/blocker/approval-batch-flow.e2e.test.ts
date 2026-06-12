import { describe, it } from 'vitest'
import { chatSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LONG_E2E_TIMEOUT_MS,
  getApprovalCard,
  seedWorkbenchReadyState,
  sendWorkbenchMessage,
  waitForLatestAssistantFinalAnswer
} from '../../../../harness/e2e/workbench'
import { getSettingsLocator } from '../../../../harness/e2e/settings'

describe('workbench run e2e', () => {
  it('approval-batch-flow', async () => {
    await runE2ECase({
      caseId: 'approval-batch-flow',
      domain: 'workbench',
      suite: 'run',
      groups: ['blocker'],
      description: 'AI 运行中收到审批批次后，用户同意或拒绝会驱动不同收口。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        await runtime.step({
          name: 'seed-ready-state',
          message: '预置 Workbench 智能模式可运行状态。',
          run: async () => {
            await seedWorkbenchReadyState(page)
          }
        })

        await runtime.step({
          name: 'approve-batch',
          message: '触发审批卡片并允许本次操作。',
          run: async () => {
            await sendWorkbenchMessage(page, '[e2e:chat-approval] 同意审批')
            await getApprovalCard(page).waitFor({ state: 'visible' })
            await getSettingsLocator(page, chatSelectors.approvalBatchApproveButton).click()
            await waitForLatestAssistantFinalAnswer(page)
          }
        })
        const approvedAnswer =
          (await page
            .locator('[data-testid^="workbench-assistant-final-answer-"]')
            .last()
            .textContent()) || ''

        await runtime.step({
          name: 'reject-batch',
          message: '再次触发审批卡片并拒绝本次操作。',
          run: async () => {
            await sendWorkbenchMessage(page, '[e2e:chat-approval] 拒绝审批')
            await getApprovalCard(page).waitFor({ state: 'visible' })
            await getSettingsLocator(page, chatSelectors.approvalBatchDenyButton).click()
            await page.waitForFunction(() => {
              return document.body.innerText.includes('俺没想明白')
            })
          }
        })
        const rejectedBodyText = await page.locator('body').textContent()
        const signals = await runtime.collectSignals()
        const approvalRequiredCount = signals.aiRunEventEntries.filter(
          (entry) => entry.event.type === 'approval_batch_required'
        ).length
        const approvalDecisionCount = signals.aiRunEventEntries.filter(
          (entry) => entry.event.type === 'approval_batch_decision'
        ).length
        const runtimeIssueCount = signals.aiRunEventEntries.filter(
          (entry) => entry.event.type === 'runtime_issue'
        ).length

        return {
          approvedAnswer,
          rejectedBodyText: rejectedBodyText || '',
          approvalRequiredCount,
          approvalDecisionCount,
          runtimeIssueCount
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.approvalRequiredCount >= 2 && result.approvalDecisionCount >= 2,
          {
            name: 'approval-events-round-trip',
            message:
              '审批卡片应由批量审批事件驱动，并在用户操作后提交审批决策，对齐 WB-BLOCKER-001-AC1、WB-BLOCKER-001-AC2。',
            data: result
          }
        )

        await runtime.assertThat(result.approvedAnswer.includes('审批通过'), {
          name: 'approved-batch-continues-run',
          message: '同一批次全部同意后，当前运行应继续执行并最终收口，对齐 WB-BLOCKER-001-AC1。',
          data: result
        })

        await runtime.assertThat(
          result.runtimeIssueCount >= 1 && result.rejectedBodyText.includes('俺没想明白'),
          {
          name: 'rejected-batch-does-not-execute',
          message:
            '只要批次中任一项被拒绝，本批命令不应执行，系统应回到后续 AI 决策收口，对齐 WB-BLOCKER-001-AC2。',
          data: result
          }
        )
      }
    })
  }, WORKBENCH_LONG_E2E_TIMEOUT_MS)
})
