import { access } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import { describe, it } from 'vitest'
import type { AiLlmIoRecord, AiRunEvent } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  chatSelectors,
  collectWorkbenchAiRunEvents,
  collectWorkbenchLlmIoRecords,
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
const TERMINAL_REVIEW_OUTCOME_TIMEOUT_MS = 120_000
const APPROVAL_WAIT_OBSERVATION_MS = 60_000

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

const isRunTerminalEvent = (event: AiRunEvent): boolean =>
  event.type === 'run_completed' ||
  event.type === 'run_failed' ||
  event.type === 'run_cancelled'

type TerminalReviewDecision = {
  commandId: string
  decision: 'auto_approve' | 'needs_human_review'
}

const readTerminalReviewDecisions = (
  records: readonly AiLlmIoRecord[],
  runId: string
): TerminalReviewDecision[] =>
  records
    .filter(
      (record) =>
        record.runId === runId &&
        record.caller === 'human.terminal_review' &&
        record.status === 'completed'
    )
    .flatMap((record) => {
      const output = record.output
      if (!output || typeof output !== 'object' || Array.isArray(output)) return []
      const decisions = output.decisions
      if (!Array.isArray(decisions)) return []
      return decisions.flatMap((decisionItem) => {
        if (!decisionItem || typeof decisionItem !== 'object' || Array.isArray(decisionItem))
          return []
        const commandId = decisionItem.commandId
        const decision = decisionItem.decision
        if (
          typeof commandId !== 'string' ||
          (decision !== 'auto_approve' && decision !== 'needs_human_review')
        ) {
          return []
        }
        return [{ commandId, decision }]
      })
    })

const waitForTerminalReviewOutcome = async (
  runtime: Parameters<typeof collectWorkbenchAiRunEvents>[0],
  runId: string,
  name: string
): Promise<AiRunEvent> =>
  await waitForWorkbenchAiEvent(runtime, {
    name,
    timeoutMs: TERMINAL_REVIEW_OUTCOME_TIMEOUT_MS,
    matches: (event) =>
      event.runId === runId &&
      (isApprovalBatchRequiredEvent(event) ||
        isRunTerminalEvent(event) ||
        event.type === 'human_interaction_required')
  })

const requireApprovalBatch = async (
  runtime: Parameters<typeof collectWorkbenchAiRunEvents>[0],
  runId: string,
  name: string
): Promise<Extract<AiRunEvent, { type: 'approval_batch_required' }>> => {
  const outcome = await waitForTerminalReviewOutcome(runtime, runId, name)
  if (isApprovalBatchRequiredEvent(outcome)) return outcome

  const decisions = readTerminalReviewDecisions(await collectWorkbenchLlmIoRecords(runtime), runId)
  const outcomeDetail =
    outcome.type === 'run_failed' ? `${outcome.type}: ${outcome.message}` : outcome.type
  throw new Error(
    `Expected a human approval batch for ${name}; run produced ${outcomeDetail}. ` +
      `Terminal review decisions: ${JSON.stringify(decisions)}`
  )
}

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
  hasAssistanceBadge: boolean
  hasSeparateGuideButton: boolean
  hasGuideInputAndSubmit: boolean
}> => {
  const card = getApprovalCard(page)
  await card.waitFor({ state: 'visible', timeout: 30_000 })
  const processRoot = await waitForLatestAssistantProcess(page)
  const waiting = page.getByTestId(workbenchSelectors.assistantApprovalWaiting)
  const waitingVisible = await waiting.isVisible().catch(() => false)
  const waitingText = waitingVisible ? ((await waiting.textContent()) || '').trim() : ''
  const processText = ((await processRoot.textContent()) || '').trim()
  const assistanceBadge = getWorkbenchPrefixLocator(
    page,
    workbenchSelectors.partnerNeedsAssistancePrefix
  ).first()
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
    ).trim(),
    hasAssistanceBadge: await assistanceBadge.isVisible().catch(() => false),
    hasSeparateGuideButton: (await card.getByRole('button', { name: /告诉|指导/ }).count()) > 0,
    hasGuideInputAndSubmit:
      (await getWorkbenchLocator(page, chatSelectors.approvalBatchGuideInput).isVisible()) &&
      (await getWorkbenchLocator(page, chatSelectors.approvalBatchSubmitButton).isVisible())
  }
}

const readApprovalReviewedItemTexts = async (page: Page): Promise<string[]> => {
  const processRoot = await waitForLatestAssistantProcess(page)
  const processToggle = getWorkbenchPrefixLocator(
    page,
    workbenchSelectors.assistantProcessTogglePrefix
  ).last()
  if ((await processToggle.getAttribute('aria-expanded')) === 'false') {
    await processToggle.click()
  }
  const panels = getWorkbenchPrefixLocator(page, workbenchSelectors.assistantProcessItemPrefix)
  const panelCount = await panels.count()
  for (let index = 0; index < panelCount; index += 1) {
    const panel = panels.nth(index)
    const className = (await panel.getAttribute('class')) || ''
    if (!className.includes('group/execution')) continue
    if (!(await panel.getAttribute('open'))) await panel.locator('summary').click()
  }
  return await processRoot
    .getByTestId(workbenchSelectors.assistantApprovalReviewedItem)
    .allTextContents()
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
        description:
          '真实 AI 触发 terminal 操作后，覆盖只读查询直通、审核自动通过、审批决策、等待恢复和完全访问。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          const authorizedDirectory = path.join(
            setup.workspace.rootPath,
            'approval-ai-auto-dir'
          )
          const approvedFile = path.join(setup.workspace.rootPath, 'approval-approved.txt')
          const deniedFile = path.join(setup.workspace.rootPath, 'approval-denied.txt')
          const guidedFile = path.join(setup.workspace.rootPath, 'approval-guided.txt')
          const fullAccessFile = path.join(setup.workspace.rootPath, 'approval-full-access.txt')

          await selectWorkbenchExecutionPermission(page, '审核')
          const queryStartedAtMs = Date.now()
          await sendWorkbenchMessage(
            page,
            '请使用终端命令列出当前工作区的文件名，不要创建、修改或删除任何文件。'
          )
          const queryRunStarted = await waitForWorkbenchAiEvent(runtime, {
            name: 'approval_readonly_query_run_started',
            matches: (event) => isRunStartedEvent(event) && event.input.includes('列出当前工作区')
          })
          if (!isRunStartedEvent(queryRunStarted)) {
            throw new Error('read-only query run did not start')
          }
          const queryEvidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            queryStartedAtMs,
            setup.env.modelName,
            undefined,
            { page, blockerPolicy: 'fail' }
          )
          recordWorkbenchAiEvidence(runtime, queryEvidence, 0.8)
          const queryEvents = (await collectWorkbenchAiRunEvents(runtime)).filter(
            (event) => event.runId === queryRunStarted.runId
          )
          const queryTerminalStepCount = queryEvents.filter(
            (event) => event.type === 'terminal_step_started'
          ).length
          const queryReviewCallCount = (await collectWorkbenchLlmIoRecords(runtime)).filter(
            (record) =>
              record.runId === queryRunStarted.runId && record.caller === 'human.terminal_review'
          ).length
          const queryApprovalCardVisible = await getApprovalCard(page)
            .isVisible()
            .catch(() => false)

          await createWorkbenchNewSession(page)
          await selectWorkbenchWorkspace(page, setup.workspaceName)
          await selectWorkbenchExecutionPermission(page, '审核')
          const authorizedStartedAtMs = Date.now()
          await sendWorkbenchMessage(
            page,
            '请使用终端在当前工作区创建名为 approval-ai-auto-dir 的空目录。我明确授权创建这个指定目录，你可以直接执行，不需要再向我确认。'
          )
          const authorizedRunStarted = await waitForWorkbenchAiEvent(runtime, {
            name: 'approval_authorized_run_started',
            matches: (event) =>
              isRunStartedEvent(event) && event.input.includes('approval-ai-auto-dir')
          })
          if (!isRunStartedEvent(authorizedRunStarted)) {
            throw new Error('explicitly authorized run did not start')
          }
          const authorizedOutcome = await waitForTerminalReviewOutcome(
            runtime,
            authorizedRunStarted.runId,
            'approval_authorized_review_outcome'
          )
          if (
            !isApprovalBatchRequiredEvent(authorizedOutcome) &&
            authorizedOutcome.type !== 'run_completed'
          ) {
            const decisions = readTerminalReviewDecisions(
              await collectWorkbenchLlmIoRecords(runtime),
              authorizedRunStarted.runId
            )
            const outcomeDetail =
              authorizedOutcome.type === 'run_failed'
                ? `${authorizedOutcome.type}: ${authorizedOutcome.message}`
                : authorizedOutcome.type
            throw new Error(
              `Expected explicit authorization to auto-approve or reach a human approval batch; ` +
                `run produced ${outcomeDetail}. Terminal review decisions: ${JSON.stringify(decisions)}`
            )
          }
          const authorizedHasApprovalEvent = isApprovalBatchRequiredEvent(authorizedOutcome)
          let authorizedApprovalCardVisible = false
          if (isApprovalBatchRequiredEvent(authorizedOutcome)) {
            const card = getApprovalCard(page)
            await card.waitFor({ state: 'visible', timeout: 30_000 })
            authorizedApprovalCardVisible = await card.isVisible()
            await decideWorkbenchApprovalBatch(runtime, page, {
              event: authorizedOutcome,
              action: 'approve'
            })
          }
          const authorizedEvidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            authorizedStartedAtMs,
            setup.env.modelName,
            undefined,
            { page, blockerPolicy: 'fail' }
          )
          recordWorkbenchAiEvidence(runtime, authorizedEvidence, 0.8)
          const authorizedReviewDecisions = readTerminalReviewDecisions(
            await collectWorkbenchLlmIoRecords(runtime),
            authorizedRunStarted.runId
          )

          await createWorkbenchNewSession(page)
          await selectWorkbenchWorkspace(page, setup.workspaceName)
          await selectWorkbenchExecutionPermission(page, '审核')
          const approveStartedAtMs = Date.now()
          await sendWorkbenchMessage(
            page,
            [
              '请使用终端命令在当前工作区创建 approval-approved.txt，内容写 approved-by-workbench-e2e。',
              '必须真正发起会触发审批的终端写入命令，并等待用户审批；不要声称已有授权或跳过审批。'
            ].join('')
          )
          const approvedRunStarted = await waitForWorkbenchAiEvent(runtime, {
            name: 'approval_approved_run_started',
            matches: (event) =>
              isRunStartedEvent(event) && event.input.includes('approval-approved.txt')
          })
          if (!isRunStartedEvent(approvedRunStarted)) {
            throw new Error('approval approved run did not start')
          }
          const approvedApproval = await requireApprovalBatch(
            runtime,
            approvedRunStarted.runId,
            'approval_approved_batch_required'
          )
          const approvedReviewDecisions = readTerminalReviewDecisions(
            await collectWorkbenchLlmIoRecords(runtime),
            approvedRunStarted.runId
          )
          const approveWaiting = await readApprovalWaitingSnapshot(page)
          const approveExpectedTitle = approvedApproval.items[0]?.commandExplanation || ''
          const approveExpectedPosition = `审批 1 / ${approvedApproval.items.length}`
          await page.waitForTimeout(APPROVAL_WAIT_OBSERVATION_MS)
          const approveWaitingAfterObservation = await readApprovalWaitingSnapshot(page)
          const approvalEventsAfterObservation = (await collectWorkbenchAiRunEvents(runtime)).filter(
            (event) => event.runId === approvedRunStarted.runId
          )
          const approveWaitRemainedPending =
            approveWaitingAfterObservation.waitingVisible &&
            approveWaitingAfterObservation.waitingText.includes('等待用户处理') &&
            !approvalEventsAfterObservation.some(isRunTerminalEvent)
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
          const approvedReviewedItemTexts = await readApprovalReviewedItemTexts(page)

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
          const firstDeniedApproval = await requireApprovalBatch(
            runtime,
            deniedRunStarted.runId,
            'approval_denied_batch_required'
          )
          const deniedReviewDecisions = readTerminalReviewDecisions(
            await collectWorkbenchLlmIoRecords(runtime),
            deniedRunStarted.runId
          )
          const deniedWaiting = await readApprovalWaitingSnapshot(page)
          const deniedExpectedTitle = firstDeniedApproval.items[0]?.commandExplanation || ''
          const deniedExpectedPosition = `审批 1 / ${firstDeniedApproval.items.length}`
          const rejectedBatchIds = new Set([firstDeniedApproval.batchId])
          await decideWorkbenchApprovalBatch(runtime, page, {
            event: firstDeniedApproval,
            action: 'reject'
          })
          await waitForDeniedRunToSettle(runtime, page, deniedRunStarted.runId, rejectedBatchIds)
          const deniedReviewedItemTexts = await readApprovalReviewedItemTexts(page)

          await createWorkbenchNewSession(page)
          await selectWorkbenchWorkspace(page, setup.workspaceName)
          await sendWorkbenchMessage(
            page,
            '请使用终端命令在当前工作区创建 approval-guided.txt，内容写 guided-by-workbench-e2e。执行前需由终端审批卡让我本人确认；请直接提交这条终端命令并等待该审批卡，不要改用对话提问。'
          )
          const guidedRunStarted = await waitForWorkbenchAiEvent(runtime, {
            name: 'approval_guided_run_started',
            matches: (event) =>
              isRunStartedEvent(event) && event.input.includes('approval-guided.txt')
          })
          if (!isRunStartedEvent(guidedRunStarted)) {
            throw new Error('approval guided run did not start')
          }
          const guidedApproval = await requireApprovalBatch(
            runtime,
            guidedRunStarted.runId,
            'approval_guided_batch_required'
          )
          const guidedReviewDecisions = readTerminalReviewDecisions(
            await collectWorkbenchLlmIoRecords(runtime),
            guidedRunStarted.runId
          )
          await getApprovalCard(page).waitFor({ state: 'visible' })
          await getWorkbenchLocator(page, chatSelectors.approvalBatchGuideInput).fill(
            '先不要创建文件，请只说明你打算执行的命令和原因。'
          )
          await getWorkbenchLocator(page, chatSelectors.approvalBatchSubmitButton).click()
          const guidedDecision = await waitForWorkbenchAiEvent(runtime, {
            name: 'approval_batch_decision_guide',
            matches: (event) =>
              event.type === 'approval_batch_decision' &&
              event.runId === guidedRunStarted.runId &&
              event.decisions.some((decision) => decision.action === 'guide')
          })
          if (guidedDecision.type !== 'approval_batch_decision') {
            throw new Error('guided approval decision was not recorded')
          }
          await waitForDeniedRunToSettle(
            runtime,
            page,
            guidedRunStarted.runId,
            new Set([guidedApproval.batchId])
          )
          const guidedReviewedItemTexts = await readApprovalReviewedItemTexts(page)
          await page.reload()
          await waitForLatestAssistantProcess(page)
          const restoredGuidedReviewedItemTexts = await readApprovalReviewedItemTexts(page)

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
          const composerPermissionAfterFullAccessSend =
            await readWorkbenchExecutionPermissionSelection(page)
          const fullAccessEvidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            fullAccessStartedAtMs,
            setup.env.modelName
          )
          recordWorkbenchAiEvidence(runtime, fullAccessEvidence, 0.8)
          const fullAccessEvents = (await collectWorkbenchAiRunEvents(runtime)).filter(
            (event) => event.runId === fullAccessRunStarted.runId
          )
          const fullAccessReviewCallCount = (await collectWorkbenchLlmIoRecords(runtime)).filter(
            (record) =>
              record.runId === fullAccessRunStarted.runId &&
              record.caller === 'human.terminal_review'
          ).length
          const fullAccessApprovalCardVisible = await getApprovalCard(page)
            .isVisible()
            .catch(() => false)

          return {
            queryTerminalStepCount,
            queryReviewCallCount,
            queryHadApprovalEvent: queryEvents.some(isApprovalBatchRequiredEvent),
            queryApprovalCardVisible,
            authorizedDirectoryExists: await exists(authorizedDirectory),
            authorizedHasApprovalEvent,
            authorizedApprovalCardVisible,
            authorizedReviewDecisions,
            approvedFileExists: await exists(approvedFile),
            approvedReviewDecisions,
            deniedFileExists: await exists(deniedFile),
            deniedReviewDecisions,
            guidedFileExists: await exists(guidedFile),
            guidedReviewDecisions,
            guidedDecision,
            guidedReviewedItemTexts,
            restoredGuidedReviewedItemTexts,
            fullAccessFileExists: await exists(fullAccessFile),
            fullAccessHasApprovalEvent: fullAccessEvents.some(isApprovalBatchRequiredEvent),
            fullAccessApprovalCardVisible,
            fullAccessReviewCallCount,
            composerPermissionAfterFullAccessSend,
            approveWaiting,
            approveWaitingAfterObservation,
            approveWaitRemainedPending,
            approveExpectedTitle,
            approveExpectedPosition,
            deniedWaiting,
            deniedExpectedTitle,
            deniedExpectedPosition,
            antMessageAfterApprove,
            approvedReviewedItemTexts,
            deniedReviewedItemTexts,
            hasApprovalRequiredEvent: isApprovalBatchRequiredEvent(approvedApproval),
            hasApprovalDecisionEvent: guidedDecision.type === 'approval_batch_decision'
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.queryTerminalStepCount > 0 &&
              result.queryReviewCallCount === 0 &&
              !result.queryHadApprovalEvent &&
              !result.queryApprovalCardVisible &&
              result.authorizedDirectoryExists &&
              result.authorizedReviewDecisions.length > 0 &&
              result.authorizedReviewDecisions.every(
                (decision) => decision.decision === 'auto_approve'
              ) &&
              !result.authorizedHasApprovalEvent &&
              !result.authorizedApprovalCardVisible &&
              result.approvedFileExists &&
              result.approvedReviewDecisions.length > 0 &&
              result.approvedReviewDecisions.every(
                (decision) => decision.decision === 'needs_human_review'
              ) &&
              !result.deniedFileExists &&
              result.deniedReviewDecisions.length > 0 &&
              result.deniedReviewDecisions.every(
                (decision) => decision.decision === 'needs_human_review'
              ) &&
              !result.guidedFileExists &&
              result.guidedReviewDecisions.length > 0 &&
              result.guidedReviewDecisions.every(
                (decision) => decision.decision === 'needs_human_review'
              ) &&
              result.fullAccessFileExists &&
              !result.fullAccessHasApprovalEvent &&
              !result.fullAccessApprovalCardVisible &&
              result.fullAccessReviewCallCount === 0 &&
              result.composerPermissionAfterFullAccessSend.includes('审核') &&
              result.hasApprovalRequiredEvent &&
              result.hasApprovalDecisionEvent,
            {
              name: 'workbench-approval-batch-real-ui-decisions',
              message:
                '只读查询应绕过审核；明确授权且范围清晰的目录请求应由 AI 自动通过并执行；明确要求本人确认的操作应进入人工审批并保留同意、拒绝和指导行为；完全访问下应跳过两层审核。',
              data: result
            }
          )
          await runtime.assertThat(
            result.approveWaiting.waitingVisible &&
              result.approveWaiting.titleText === result.approveExpectedTitle &&
              result.approveWaiting.positionText === result.approveExpectedPosition &&
              result.approveWaiting.waitingText.includes('等待用户处理') &&
              !result.approveWaiting.hasBlockerNotice &&
              !result.approveWaiting.hasAssistanceBadge &&
              !result.approveWaiting.hasSeparateGuideButton &&
              result.approveWaiting.hasGuideInputAndSubmit &&
              !result.approveWaiting.antMessageText.includes('需要审核') &&
              result.approveWaitRemainedPending &&
              !result.approveWaitingAfterObservation.hasSeparateGuideButton &&
              result.approveWaitingAfterObservation.hasGuideInputAndSubmit &&
              result.deniedWaiting.waitingVisible &&
              result.deniedWaiting.titleText === result.deniedExpectedTitle &&
              result.deniedWaiting.positionText === result.deniedExpectedPosition &&
              result.deniedWaiting.waitingText.includes('等待用户处理') &&
              !result.deniedWaiting.hasBlockerNotice &&
              !result.deniedWaiting.hasAssistanceBadge &&
              !result.deniedWaiting.hasSeparateGuideButton &&
              result.deniedWaiting.hasGuideInputAndSubmit &&
              !result.deniedWaiting.antMessageText.includes('需要审核') &&
              !result.antMessageAfterApprove.includes('审核已通过'),
            {
              name: 'workbench-approval-activity-waiting-and-no-toast',
              message:
                '等待审批时 Activity header 应为「等待用户处理」，且过程流无 blockers、无开始/通过 toast，对齐 WB-BLOCKER-001-AC6。',
              data: {
                authorizedReviewDecisions: result.authorizedReviewDecisions,
                approvedReviewDecisions: result.approvedReviewDecisions,
                deniedReviewDecisions: result.deniedReviewDecisions,
                guidedReviewDecisions: result.guidedReviewDecisions,
                fullAccessReviewCallCount: result.fullAccessReviewCallCount,
                approveWaiting: result.approveWaiting,
                deniedWaiting: result.deniedWaiting,
                antMessageAfterApprove: result.antMessageAfterApprove
              }
            }
          )
          await runtime.assertThat(
            result.approvedReviewedItemTexts.some((text) => text.includes('审核结果：已允许')) &&
              result.deniedReviewedItemTexts.some((text) => text.includes('审核结果：已拒绝')) &&
              result.guidedReviewedItemTexts.some((text) =>
                text.includes('审核结果：已提供指导：先不要创建文件，请只说明你打算执行的命令和原因。')
              ) &&
              result.restoredGuidedReviewedItemTexts.some((text) =>
                text.includes('审核结果：已提供指导：先不要创建文件，请只说明你打算执行的命令和原因。')
              ),
            {
              name: 'workbench-approval-reviewed-activity-items',
              message:
                '审后工具行以文字显示同意、拒绝和指导结果，刷新后仍能恢复指导结果，对齐 WB-BLOCKER-001-AC7。',
              data: {
                approvedReviewedItemTexts: result.approvedReviewedItemTexts,
                deniedReviewedItemTexts: result.deniedReviewedItemTexts,
                guidedReviewedItemTexts: result.guidedReviewedItemTexts,
                restoredGuidedReviewedItemTexts: result.restoredGuidedReviewedItemTexts
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
