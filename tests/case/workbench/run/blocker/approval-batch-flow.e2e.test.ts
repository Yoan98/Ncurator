import { access } from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import type { AiRunEvent } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  chatSelectors,
  collectWorkbenchAiRunEvents,
  createWorkbenchNewSession,
  decideWorkbenchApprovalBatch,
  getApprovalCard,
  getWorkbenchLocator,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  selectWorkbenchWorkspace,
  setupWorkbenchWithTempWorkspace,
  waitForWorkbenchAiEvent,
  waitForWorkbenchAiRunCompletion
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'approval-batch-flow'
const DENIED_RUN_SETTLE_TIMEOUT_MS = 120_000

const exists = async (filePath: string): Promise<boolean> =>
  await access(filePath)
    .then(() => true)
    .catch(() => false)

const isRunStartedEvent = (
  event: AiRunEvent
): event is Extract<AiRunEvent, { type: 'run_started' }> => event.type === 'run_started'

const isApprovalBatchRequiredEvent = (
  event: AiRunEvent
): event is Extract<AiRunEvent, { type: 'approval_batch_required' }> =>
  event.type === 'approval_batch_required'

const waitForDeniedRunToSettle = async (
  runtime: Parameters<typeof collectWorkbenchAiRunEvents>[0],
  page: Parameters<typeof getApprovalCard>[0],
  runId: string,
  rejectedBatchIds: Set<string>
): Promise<void> => {
  const deadline = Date.now() + DENIED_RUN_SETTLE_TIMEOUT_MS
  for (;;) {
    const events = await collectWorkbenchAiRunEvents(runtime)
    const settled = events.some(
      (event) =>
        (event.type === 'run_completed' || event.type === 'run_cancelled') && event.runId === runId
    )
    if (settled) return

    const nextApproval = events
      .filter(
        (event): event is Extract<AiRunEvent, { type: 'approval_batch_required' }> =>
          isApprovalBatchRequiredEvent(event) &&
          event.runId === runId &&
          !rejectedBatchIds.has(event.batchId)
      )
      .at(-1)
    if (nextApproval) {
      await decideWorkbenchApprovalBatch(runtime, page, {
        event: nextApproval,
        action: 'reject',
        timeoutMs: 30_000
      })
      rejectedBatchIds.add(nextApproval.batchId)
      continue
    }

    if (Date.now() >= deadline) {
      throw new Error(`denied run did not settle after repeated rejects: ${runId}`)
    }
    await page.waitForTimeout(500)
  }
}

describe('workbench run e2e', () => {
  it(
    CASE_ID,
    async () => {
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
            const approvedApproval = await waitForWorkbenchAiEvent(runtime, {
              name: 'approval_approved_batch_required',
              matches: isApprovalBatchRequiredEvent
            })
            if (!isApprovalBatchRequiredEvent(approvedApproval)) {
              throw new Error('approval approved batch was not required')
            }
            await decideWorkbenchApprovalBatch(runtime, page, {
              event: approvedApproval,
              action: 'approve'
            })
            const approveEvidence = await waitForWorkbenchAiRunCompletion(
              runtime,
              approveStartedAtMs,
              setup.env.modelName
            )
            recordWorkbenchAiEvidence(runtime, approveEvidence, 0.8)

            await sendWorkbenchMessage(
              page,
              '请使用终端命令在当前工作区创建 approval-denied.txt，内容写 denied-by-workbench-e2e；如果本次操作未获授权，请不要再次申请执行，直接说明未执行。'
            )
            const deniedRunStarted = await waitForWorkbenchAiEvent(runtime, {
              name: 'approval_denied_run_started',
              matches: (event) =>
                isRunStartedEvent(event) && event.input.includes('approval-denied.txt')
            })
            if (!isRunStartedEvent(deniedRunStarted)) {
              throw new Error('approval denied run did not start')
            }
            const firstDeniedApproval = await waitForWorkbenchAiEvent(runtime, {
              name: 'approval_denied_batch_required',
              matches: (event) =>
                isApprovalBatchRequiredEvent(event) && event.runId === deniedRunStarted.runId
            })
            if (!isApprovalBatchRequiredEvent(firstDeniedApproval)) {
              throw new Error('approval denied batch was not required')
            }
            const rejectedBatchIds = new Set([firstDeniedApproval.batchId])
            await decideWorkbenchApprovalBatch(runtime, page, {
              event: firstDeniedApproval,
              action: 'reject'
            })
            await waitForDeniedRunToSettle(runtime, page, deniedRunStarted.runId, rejectedBatchIds)

            await createWorkbenchNewSession(page)
            await selectWorkbenchWorkspace(page, setup.workspaceName)
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
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
