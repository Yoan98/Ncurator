import { access } from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  chatSelectors,
  getApprovalCard,
  getWorkbenchLocator,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForWorkbenchAiEvent,
  waitForWorkbenchAiRunCompletion
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'approval-batch-flow'

const exists = async (filePath: string): Promise<boolean> =>
  await access(filePath)
    .then(() => true)
    .catch(() => false)

describe('workbench run e2e', () => {
  it(CASE_ID, async () => {
    await runE2ECase({
      caseId: CASE_ID,
      domain: 'workbench',
      suite: 'run',
      groups: ['blocker'],
      description: '真实 AI 触发 terminal 审批后，覆盖同意执行、拒绝无副作用和指导输入回流。',
      fixtures: ['tests/fixtures/workspace'],
      launchMode: 'real',
      windowMode: 'visible',
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
        try {
          const approvedFile = path.join(setup.workspace.rootPath, 'approval-approved.txt')
          const deniedFile = path.join(setup.workspace.rootPath, 'approval-denied.txt')
          const guidedFile = path.join(setup.workspace.rootPath, 'approval-guided.txt')

          const approveStartedAtMs = Date.now()
          await sendWorkbenchMessage(
            page,
            '请使用终端命令在当前工作区创建 approval-approved.txt，内容写 approved-by-workbench-e2e。'
          )
          await getApprovalCard(page).waitFor({ state: 'visible' })
          await getWorkbenchLocator(page, chatSelectors.approvalBatchApproveButton).click()
          const approveEvidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            approveStartedAtMs,
            setup.env.modelName
          )
          recordWorkbenchAiEvidence(runtime, approveEvidence, 0.8)

          await sendWorkbenchMessage(
            page,
            '请使用终端命令在当前工作区创建 approval-denied.txt，内容写 denied-by-workbench-e2e。'
          )
          await getApprovalCard(page).waitFor({ state: 'visible' })
          await getWorkbenchLocator(page, chatSelectors.approvalBatchDenyButton).click()
          await waitForWorkbenchAiEvent(runtime, {
            name: 'approval_batch_decision_reject',
            matches: (event) =>
              event.type === 'approval_batch_decision' &&
              event.decisions.some((decision) => decision.action === 'reject')
          })

          await sendWorkbenchMessage(
            page,
            '请使用终端命令在当前工作区创建 approval-guided.txt，内容写 guided-by-workbench-e2e。'
          )
          await getApprovalCard(page).waitFor({ state: 'visible' })
          await getWorkbenchLocator(page, chatSelectors.approvalBatchGuideInput).fill(
            '先不要创建文件，请只说明你打算执行的命令和原因。'
          )
          await getWorkbenchLocator(page, chatSelectors.approvalBatchSubmitButton).click()
          await waitForWorkbenchAiEvent(runtime, {
            name: 'approval_batch_decision_guide',
            matches: (event) =>
              event.type === 'approval_batch_decision' &&
              event.decisions.some((decision) => decision.action === 'guide')
          })

          return {
            approvedFileExists: await exists(approvedFile),
            deniedFileExists: await exists(deniedFile),
            guidedFileExists: await exists(guidedFile),
            eventTypes: (await runtime.collectSignals()).aiRunEventEntries.map(
              (entry) => entry.event.type
            )
          }
        } finally {
          await setup.workspace.cleanup()
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.approvedFileExists &&
            !result.deniedFileExists &&
            !result.guidedFileExists &&
            result.eventTypes.includes('approval_batch_required') &&
            result.eventTypes.includes('approval_batch_decision'),
          {
            name: 'workbench-approval-batch-real-ui-decisions',
            message:
              '真实审批卡片同意后应执行命令；拒绝或指导输入时对应命令不应产生文件副作用，对齐 WB-BLOCKER-001-AC1 至 WB-BLOCKER-001-AC4。',
            data: result
          }
        )
        await assertNoWorkbenchFakeSignals(runtime)
      }
    })
  }, WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS)
})
