import { access } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
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
  getAntMessageText,
  getApprovalCard,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  selectWorkbenchExecutionPermission,
  readWorkbenchExecutionPermissionSelection,
  selectWorkbenchWorkspace,
  setupWorkbenchWithTempWorkspace,
  waitForLatestAssistantProcess,
  waitForWorkbenchAiEvent,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'approval-batch-flow'
const DENIED_RUN_SETTLE_TIMEOUT_MS = 120_000
const DENIED_APPROVAL_WAIT_TIMEOUT_MS = 120_000

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

const readApprovalWaitingSnapshot = async (
  page: Page
): Promise<{
  waitingVisible: boolean
  waitingText: string
  processText: string
  hasBlockerNotice: boolean
  antMessageText: string
  titleText: string
  positionText: string
}> => {
  const card = getApprovalCard(page)
  await card.waitFor({ state: 'visible', timeout: 30_000 })
  const processRoot = await waitForLatestAssistantProcess(page)
  const waiting = page.getByTestId(workbenchSelectors.assistantApprovalWaiting)
  const waitingVisible = await waiting.isVisible().catch(() => false)
  const waitingText = waitingVisible ? ((await waiting.textContent()) || '').trim() : ''
  const processText = ((await processRoot.textContent()) || '').trim()
  return {
    waitingVisible,
    waitingText,
    processText,
    hasBlockerNotice: processText.includes('等待批量审核'),
    antMessageText: await getAntMessageText(page),
    titleText: (
      (await card.getByTestId(`${chatSelectors.approvalBatchCard}-title`).textContent()) || ''
    ).trim(),
    positionText: (
      (await card.getByTestId(`${chatSelectors.approvalBatchCard}-position`).textContent()) || ''
    ).trim()
  }
}

const countApprovalReviewedItems = async (page: Page): Promise<number> => {
  const processRoot = await waitForLatestAssistantProcess(page)
  const panels = getWorkbenchPrefixLocator(page, workbenchSelectors.assistantProcessItemPrefix)
  const panelCount = await panels.count()
  for (let index = 0; index < panelCount; index += 1) {
    const panel = panels.nth(index)
    const className = (await panel.getAttribute('class')) || ''
    if (!className.includes('group/execution')) continue
    await panel.evaluate((element) => {
      element.setAttribute('open', '')
    })
  }
  return await processRoot.getByTestId(workbenchSelectors.assistantApprovalReviewedItem).count()
}

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
        description: '真实 AI 触发 terminal 操作后，覆盖审核审批、拒绝无副作用、指导输入和完全访问自动执行。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          const approvedFile = path.join(setup.workspace.rootPath, 'approval-approved.txt')
          const deniedFile = path.join(setup.workspace.rootPath, 'approval-denied.txt')
          const guidedFile = path.join(setup.workspace.rootPath, 'approval-guided.txt')
          const fullAccessFile = path.join(setup.workspace.rootPath, 'approval-full-access.txt')

          await selectWorkbenchExecutionPermission(page, '审核')
          const approveStartedAtMs = Date.now()
          await sendWorkbenchMessage(
            page,
            [
              '请使用终端命令在当前工作区创建 approval-approved.txt，内容写 approved-by-workbench-e2e。',
              '必须真正发起会触发审批的终端写入命令，并等待用户审批；不要声称已有授权或跳过审批。'
            ].join('')
          )
          const approvedApproval = await waitForWorkbenchAiEvent(runtime, {
            name: 'approval_approved_batch_required',
            matches: isApprovalBatchRequiredEvent
          })
          if (!isApprovalBatchRequiredEvent(approvedApproval)) {
            throw new Error('approval approved batch was not required')
          }
          const approveWaiting = await readApprovalWaitingSnapshot(page)
          const approveExpectedTitle = approvedApproval.items[0]?.commandExplanation || ''
          const approveExpectedPosition = `审批 1 / ${approvedApproval.items.length}`
          await decideWorkbenchApprovalBatch(runtime, page, {
            event: approvedApproval,
            action: 'approve'
          })
          const antMessageAfterApprove = await getAntMessageText(page)
          const approveEvidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            approveStartedAtMs,
            setup.env.modelName,
            undefined,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, approveEvidence, 0.8)
          const approvedReviewedItemCount = await countApprovalReviewedItems(page)

          await createWorkbenchNewSession(page)
          await selectWorkbenchWorkspace(page, setup.workspaceName)
          await sendWorkbenchMessage(
            page,
            [
              '请使用终端命令在当前工作区创建 approval-denied.txt，内容写 denied-by-workbench-e2e。',
              '必须真正发起会触发审批的终端写入命令，并等待用户审批；不要声称已有授权或跳过审批。',
              '如果本次操作未获授权，请不要再次申请执行，直接说明未执行。'
            ].join('')
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
            timeoutMs: DENIED_APPROVAL_WAIT_TIMEOUT_MS,
            matches: (event) =>
              isApprovalBatchRequiredEvent(event) && event.runId === deniedRunStarted.runId
          })
          if (!isApprovalBatchRequiredEvent(firstDeniedApproval)) {
            throw new Error('approval denied batch was not required')
          }
          const deniedWaiting = await readApprovalWaitingSnapshot(page)
          const deniedExpectedTitle = firstDeniedApproval.items[0]?.commandExplanation || ''
          const deniedExpectedPosition = `审批 1 / ${firstDeniedApproval.items.length}`
          const rejectedBatchIds = new Set([firstDeniedApproval.batchId])
          await decideWorkbenchApprovalBatch(runtime, page, {
            event: firstDeniedApproval,
            action: 'reject'
          })
          await waitForDeniedRunToSettle(runtime, page, deniedRunStarted.runId, rejectedBatchIds)
          const deniedReviewedItemCount = await countApprovalReviewedItems(page)

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

          await createWorkbenchNewSession(page)
          await selectWorkbenchWorkspace(page, setup.workspaceName)
          await selectWorkbenchExecutionPermission(page, '完全访问')
          const fullAccessStartedAtMs = Date.now()
          await sendWorkbenchMessage(
            page,
            '请使用终端命令在当前工作区创建 approval-full-access.txt，内容写 full-access-by-workbench-e2e。'
          )
          const fullAccessRunStarted = await waitForWorkbenchAiEvent(runtime, {
            name: 'approval_full_access_run_started',
            matches: (event) =>
              isRunStartedEvent(event) && event.input.includes('approval-full-access.txt')
          })
          if (!isRunStartedEvent(fullAccessRunStarted)) {
            throw new Error('full access run did not start')
          }
          await selectWorkbenchExecutionPermission(page, '审核')
          const composerPermissionAfterFullAccessSend = await readWorkbenchExecutionPermissionSelection(
            page
          )
          const fullAccessEvidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            fullAccessStartedAtMs,
            setup.env.modelName
          )
          recordWorkbenchAiEvidence(runtime, fullAccessEvidence, 0.8)
          const fullAccessEvents = (await collectWorkbenchAiRunEvents(runtime)).filter(
            (event) => event.runId === fullAccessRunStarted.runId
          )
          const fullAccessApprovalCardVisible = await getApprovalCard(page).isVisible().catch(() => false)

          return {
            approvedFileExists: await exists(approvedFile),
            deniedFileExists: await exists(deniedFile),
            guidedFileExists: await exists(guidedFile),
            fullAccessFileExists: await exists(fullAccessFile),
            fullAccessHasApprovalEvent: fullAccessEvents.some(isApprovalBatchRequiredEvent),
            fullAccessApprovalCardVisible,
            composerPermissionAfterFullAccessSend,
            approveWaiting,
            approveExpectedTitle,
            approveExpectedPosition,
            deniedWaiting,
            deniedExpectedTitle,
            deniedExpectedPosition,
            antMessageAfterApprove,
            approvedReviewedItemCount,
            deniedReviewedItemCount,
            eventTypes: (await runtime.collectSignals()).aiRunEventEntries.map(
              (entry) => entry.event.type
            )
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.approvedFileExists &&
              !result.deniedFileExists &&
              !result.guidedFileExists &&
              result.fullAccessFileExists &&
              !result.fullAccessHasApprovalEvent &&
              !result.fullAccessApprovalCardVisible &&
              result.composerPermissionAfterFullAccessSend.includes('审核') &&
              result.eventTypes.includes('approval_batch_required') &&
              result.eventTypes.includes('approval_batch_decision'),
            {
              name: 'workbench-approval-batch-real-ui-decisions',
              message:
                '审核模式应保留审批卡片、同意和拒绝行为；完全访问执行同类终端命令时不应产生审批事件或审批卡片，且文件应实际创建，对齐 WB-BLOCKER-001。',
              data: result
            }
          )
          await runtime.assertThat(
            result.approveWaiting.waitingVisible &&
              result.approveWaiting.titleText === result.approveExpectedTitle &&
              result.approveWaiting.positionText === result.approveExpectedPosition &&
              result.approveWaiting.waitingText.includes('等待用户审核中') &&
              !result.approveWaiting.hasBlockerNotice &&
              !result.approveWaiting.antMessageText.includes('需要审核') &&
              result.deniedWaiting.waitingVisible &&
              result.deniedWaiting.titleText === result.deniedExpectedTitle &&
              result.deniedWaiting.positionText === result.deniedExpectedPosition &&
              result.deniedWaiting.waitingText.includes('等待用户审核中') &&
              !result.deniedWaiting.hasBlockerNotice &&
              !result.deniedWaiting.antMessageText.includes('需要审核') &&
              !result.antMessageAfterApprove.includes('审核已通过'),
            {
              name: 'workbench-approval-activity-waiting-and-no-toast',
              message:
                '等待审批时 Activity header 应为「等待用户审核中」，且过程流无 blockers、无开始/通过 toast，对齐 WB-BLOCKER-001-AC6。',
              data: {
                approveWaiting: result.approveWaiting,
                deniedWaiting: result.deniedWaiting,
                antMessageAfterApprove: result.antMessageAfterApprove
              }
            }
          )
          await runtime.assertThat(
            result.approvedReviewedItemCount >= 1 && result.deniedReviewedItemCount >= 1,
            {
              name: 'workbench-approval-reviewed-activity-items',
              message:
                '审完后走过审批的工具行应带审核标记，对齐 WB-BLOCKER-001-AC7。',
              data: {
                approvedReviewedItemCount: result.approvedReviewedItemCount,
                deniedReviewedItemCount: result.deniedReviewedItemCount
              }
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
