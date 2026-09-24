import { access, mkdir } from 'node:fs/promises'
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
const IS_WINDOWS = process.platform === 'win32'
const GUIDE_MESSAGE =
  '先不要删除这个文件，也不要改用其他命令。请说明待执行命令会删除哪个文件，以及这项操作的影响。'

const exists = async (filePath: string): Promise<boolean> =>
  await access(filePath)
    .then(() => true)
    .catch(() => false)

const quoteShellPath = (filePath: string): string =>
  IS_WINDOWS
    ? "'" + filePath.replaceAll("'", "''") + "'"
    : "'" + filePath.replaceAll("'", "'\\''") + "'"

const isRunStartedEvent = (
  event: AiRunEvent
): event is Extract<AiRunEvent, { type: 'run_started' }> => event.type === 'run_started'

const isApprovalBatchRequiredEvent = (
  event: AiRunEvent
): event is Extract<AiRunEvent, { type: 'approval_batch_required' }> =>
  event.type === 'approval_batch_required'

const isRunTerminalEvent = (event: AiRunEvent): boolean =>
  event.type === 'run_completed' || event.type === 'run_failed' || event.type === 'run_cancelled'

type TerminalReviewDecision = {
  commandId: string
  decision: 'auto_approve' | 'needs_human_review'
  reason: string
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
        const reason = decisionItem.reason
        if (
          typeof commandId !== 'string' ||
          (decision !== 'auto_approve' && decision !== 'needs_human_review') ||
          typeof reason !== 'string' ||
          reason.trim().length === 0
        ) {
          return []
        }
        return [{ commandId, decision, reason }]
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
      (await card.getByTestId(chatSelectors.approvalBatchCard + '-title').textContent()) || ''
    ).trim(),
    positionText: (
      (await card.getByTestId(chatSelectors.approvalBatchCard + '-position').textContent()) || ''
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
  page: Page,
  runId: string,
  rejectedBatchIds: Set<string>
): Promise<void> => {
  const deadline = Date.now() + DENIED_RUN_SETTLE_TIMEOUT_MS
  for (;;) {
    const events = await collectWorkbenchAiRunEvents(runtime)
    if (events.some((event) => event.runId === runId && isRunTerminalEvent(event))) return

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
      throw new Error('denied run did not settle after repeated rejects: ' + runId)
    }
    await page.waitForTimeout(500)
  }
}

type TerminalScenarioAction = 'approve' | 'reject' | 'guide'

type TerminalScenarioResult = {
  runId: string
  action: TerminalScenarioAction
  hadApproval: boolean
  reviewDecisions: TerminalReviewDecision[]
  approvalWaiting: Awaited<ReturnType<typeof readApprovalWaitingSnapshot>> | null
  approvalDecisionActions: string[]
  reviewedItemTexts: string[]
  restoredReviewedItemTexts: string[]
  outputPathExists: boolean
}

const runTerminalScenario = async (input: {
  runtime: Parameters<typeof collectWorkbenchAiRunEvents>[0]
  page: Page
  modelName: string
  name: string
  inputIncludes: string
  userMessage: string
  outputPath: string
  action: TerminalScenarioAction
  guideMessage?: string
}): Promise<TerminalScenarioResult> => {
  const startedAtMs = Date.now()
  await sendWorkbenchMessage(input.page, input.userMessage)
  const runStarted = await waitForWorkbenchAiEvent(input.runtime, {
    name: input.name + '_run_started',
    matches: (event) => isRunStartedEvent(event) && event.input.includes(input.inputIncludes)
  })
  if (!isRunStartedEvent(runStarted)) throw new Error(input.name + ' run did not start')

  const outcome = await waitForTerminalReviewOutcome(input.runtime, runStarted.runId, input.name)
  let approvalEvent: Extract<AiRunEvent, { type: 'approval_batch_required' }> | null = null
  let approvalWaiting: TerminalScenarioResult['approvalWaiting'] = null

  if (isApprovalBatchRequiredEvent(outcome)) {
    approvalEvent = outcome
    await getApprovalCard(input.page).waitFor({ state: 'visible', timeout: 30_000 })
    approvalWaiting = await readApprovalWaitingSnapshot(input.page)

    if (input.action === 'guide') {
      if (!input.guideMessage) throw new Error(input.name + ' guide message is missing')
      await getWorkbenchLocator(input.page, chatSelectors.approvalBatchGuideInput).fill(
        input.guideMessage
      )
      await getWorkbenchLocator(input.page, chatSelectors.approvalBatchSubmitButton).click()
      const guideDecision = await waitForWorkbenchAiEvent(input.runtime, {
        name: input.name + '_guide_decision',
        matches: (event) =>
          event.type === 'approval_batch_decision' &&
          event.runId === runStarted.runId &&
          event.decisions.some((decision) => decision.action === 'guide')
      })
      if (guideDecision.type !== 'approval_batch_decision') {
        throw new Error(input.name + ' guide decision was not recorded')
      }
      await waitForDeniedRunToSettle(
        input.runtime,
        input.page,
        runStarted.runId,
        new Set([outcome.batchId])
      )
    } else {
      await decideWorkbenchApprovalBatch(input.runtime, input.page, {
        event: outcome,
        action: input.action
      })
      if (input.action === 'reject') {
        await waitForDeniedRunToSettle(
          input.runtime,
          input.page,
          runStarted.runId,
          new Set([outcome.batchId])
        )
      }
    }
  } else if (outcome.type !== 'run_completed') {
    const decisions = readTerminalReviewDecisions(
      await collectWorkbenchLlmIoRecords(input.runtime),
      runStarted.runId
    )
    const detail =
      outcome.type === 'run_failed' ? outcome.type + ': ' + outcome.message : outcome.type
    throw new Error(input.name + ' run produced ' + detail + ': ' + JSON.stringify(decisions))
  }

  const evidence = await waitForWorkbenchAiRunCompletion(
    input.runtime,
    startedAtMs,
    input.modelName,
    undefined,
    { page: input.page, blockerPolicy: 'fail' }
  )
  recordWorkbenchAiEvidence(input.runtime, evidence, 0.8)

  const runEvents = (await collectWorkbenchAiRunEvents(input.runtime)).filter(
    (event) => event.runId === runStarted.runId
  )
  const reviewDecisions = readTerminalReviewDecisions(
    await collectWorkbenchLlmIoRecords(input.runtime),
    runStarted.runId
  )
  const hadApproval = approvalEvent !== null
  const reviewedItemTexts = hadApproval ? await readApprovalReviewedItemTexts(input.page) : []
  let restoredReviewedItemTexts: string[] = []
  if (hadApproval && input.action === 'guide') {
    await input.page.reload()
    await waitForLatestAssistantProcess(input.page)
    restoredReviewedItemTexts = await readApprovalReviewedItemTexts(input.page)
  }

  return {
    runId: runStarted.runId,
    action: input.action,
    hadApproval,
    reviewDecisions,
    approvalWaiting,
    approvalDecisionActions: runEvents.flatMap((event) =>
      event.type === 'approval_batch_decision'
        ? event.decisions.map((decision) => decision.action)
        : []
    ),
    reviewedItemTexts,
    restoredReviewedItemTexts,
    outputPathExists: await exists(input.outputPath)
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
          '同一真实 Workbench E2E case 通过多轮运行验证只读查询、终端审核、审批卡决策和完全访问流程。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          const authorizedDirectory = path.join(setup.workspace.rootPath, 'approval-created-dir')
          const fullAccessFile = path.join(setup.workspace.rootPath, 'approval-full-access.txt')
          const permissionTargets = {
            approve: {
              directory: path.join(setup.workspace.rootPath, 'permission-approve-target'),
              marker: path.join(
                setup.workspace.rootPath,
                'permission-approve-target',
                'changed.txt'
              )
            },
            reject: {
              directory: path.join(setup.workspace.rootPath, 'permission-reject-target'),
              marker: path.join(setup.workspace.rootPath, 'permission-reject-target', 'changed.txt')
            },
            guide: {
              directory: path.join(setup.workspace.rootPath, 'permission-guide-target'),
              marker: path.join(setup.workspace.rootPath, 'permission-guide-target', 'changed.txt')
            }
          }
          const makeDirectoryCommand = IS_WINDOWS
            ? 'New-Item -ItemType Directory -Force -Path ' +
              quoteShellPath(authorizedDirectory) +
              ' | Out-Null'
            : 'mkdir -p ' + quoteShellPath(authorizedDirectory)
          const changePermissionsAndCreateMarkerCommand = (input: {
            directory: string
            marker: string
          }): string =>
            IS_WINDOWS
              ? 'icacls ' +
                quoteShellPath(input.directory) +
                " /grant '*S-1-1-0:F' /T; if ($LASTEXITCODE -eq 0) { Set-Content -LiteralPath " +
                quoteShellPath(input.marker) +
                " -Value 'permission-updated' }"
              : 'chmod -R 777 ' +
                quoteShellPath(input.directory) +
                " && printf '%s' 'permission-updated' > " +
                quoteShellPath(input.marker)
          const createFileCommand = IS_WINDOWS
            ? 'Set-Content -LiteralPath ' +
              quoteShellPath(fullAccessFile) +
              " -Value 'full-access-by-workbench-e2e'"
            : "printf '%s' 'full-access-by-workbench-e2e' > " + quoteShellPath(fullAccessFile)

          await Promise.all([
            mkdir(setup.workspace.rootPath, { recursive: true }),
            ...Object.values(permissionTargets).map(({ directory }) =>
              mkdir(directory, { recursive: true })
            )
          ])

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

          const startAuditSession = async (): Promise<void> => {
            await createWorkbenchNewSession(page)
            await selectWorkbenchWorkspace(page, setup.workspaceName)
            await selectWorkbenchExecutionPermission(page, '审核')
          }

          await startAuditSession()
          const createScenario = await runTerminalScenario({
            runtime,
            page,
            modelName: setup.env.modelName,
            name: 'approval_create_directory',
            inputIncludes: 'approval-created-dir',
            userMessage:
              '请在当前工作区通过终端执行这条命令，并告诉我结果：\n' + makeDirectoryCommand,
            outputPath: authorizedDirectory,
            action: 'approve'
          })

          await startAuditSession()
          const approvePermissionScenario = await runTerminalScenario({
            runtime,
            page,
            modelName: setup.env.modelName,
            name: 'approval_permission_change_approve',
            inputIncludes: 'permission-approve-target',
            userMessage:
              '请把这个隔离测试目录递归设置为所有本机账户都可读写，然后在其中写入标记文件。请执行这条命令并说明结果：\n' +
              changePermissionsAndCreateMarkerCommand(permissionTargets.approve),
            outputPath: permissionTargets.approve.marker,
            action: 'approve'
          })

          await startAuditSession()
          const rejectScenario = await runTerminalScenario({
            runtime,
            page,
            modelName: setup.env.modelName,
            name: 'approval_permission_change_reject',
            inputIncludes: 'permission-reject-target',
            userMessage:
              '请把这个隔离测试目录递归设置为所有本机账户都可读写，然后在其中写入标记文件。请执行这条命令并说明结果：\n' +
              changePermissionsAndCreateMarkerCommand(permissionTargets.reject),
            outputPath: permissionTargets.reject.marker,
            action: 'reject'
          })

          await startAuditSession()
          const guideScenario = await runTerminalScenario({
            runtime,
            page,
            modelName: setup.env.modelName,
            name: 'approval_permission_change_guide',
            inputIncludes: 'permission-guide-target',
            userMessage:
              '请把这个隔离测试目录递归设置为所有本机账户都可读写，然后在其中写入标记文件。请执行这条命令并说明结果：\n' +
              changePermissionsAndCreateMarkerCommand(permissionTargets.guide),
            outputPath: permissionTargets.guide.marker,
            action: 'guide',
            guideMessage: GUIDE_MESSAGE
          })

          await createWorkbenchNewSession(page)
          await selectWorkbenchWorkspace(page, setup.workspaceName)
          await selectWorkbenchExecutionPermission(page, '完全访问')
          const fullAccessStartedAtMs = Date.now()
          await sendWorkbenchMessage(
            page,
            '请在当前工作区通过终端执行这条命令，并告诉我结果：\n' + createFileCommand
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
            setup.env.modelName,
            undefined,
            { page, blockerPolicy: 'fail' }
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

          const reviewScenarios = [
            createScenario,
            approvePermissionScenario,
            rejectScenario,
            guideScenario
          ]
          const reviewedScenariosWithReasons = reviewScenarios.every(
            (scenario) =>
              scenario.reviewDecisions.length > 0 &&
              scenario.reviewDecisions.every((decision) => decision.reason.trim().length > 0)
          )
          const scenarioSideEffectsMatchActualFlow =
            createScenario.outputPathExists &&
            approvePermissionScenario.outputPathExists &&
            rejectScenario.outputPathExists === !rejectScenario.hadApproval &&
            guideScenario.outputPathExists === !guideScenario.hadApproval

          return {
            queryTerminalStepCount,
            queryReviewCallCount,
            queryHadApprovalEvent: queryEvents.some(isApprovalBatchRequiredEvent),
            queryApprovalCardVisible,
            createScenario,
            approvePermissionScenario,
            rejectScenario,
            guideScenario,
            reviewedScenariosWithReasons,
            scenarioSideEffectsMatchActualFlow,
            fullAccessFileExists: await exists(fullAccessFile),
            fullAccessHasApprovalEvent: fullAccessEvents.some(isApprovalBatchRequiredEvent),
            fullAccessApprovalCardVisible,
            fullAccessReviewCallCount,
            composerPermissionAfterFullAccessSend
          }
        },
        assert: async (result, runtime) => {
          const scenarios = [
            result.createScenario,
            result.approvePermissionScenario,
            result.rejectScenario,
            result.guideScenario
          ]
          const approvalCardsAreWellFormed = scenarios
            .filter((scenario) => scenario.hadApproval)
            .every((scenario) => {
              const snapshot = scenario.approvalWaiting
              return Boolean(
                snapshot &&
                snapshot.waitingVisible &&
                snapshot.titleText.length > 0 &&
                snapshot.positionText.startsWith('审批 1 /') &&
                snapshot.waitingText.includes('等待用户处理') &&
                !snapshot.hasBlockerNotice &&
                !snapshot.hasAssistanceBadge &&
                !snapshot.hasSeparateGuideButton &&
                snapshot.hasGuideInputAndSubmit &&
                !snapshot.antMessageText.includes('需要审核')
              )
            })
          const userDecisionsWereRecorded = scenarios.every((scenario) => {
            if (!scenario.hadApproval) return true
            const expectedResult =
              scenario.action === 'approve'
                ? '审核结果：已允许'
                : scenario.action === 'reject'
                  ? '审核结果：已拒绝'
                  : '审核结果：已提供指导：' + GUIDE_MESSAGE
            return (
              scenario.approvalDecisionActions.includes(scenario.action) &&
              scenario.reviewedItemTexts.some((text) => text.includes(expectedResult)) &&
              (scenario.action !== 'guide' ||
                scenario.restoredReviewedItemTexts.some((text) => text.includes(expectedResult)))
            )
          })

          await runtime.assertThat(
            result.queryTerminalStepCount > 0 &&
              result.queryReviewCallCount === 0 &&
              !result.queryHadApprovalEvent &&
              !result.queryApprovalCardVisible &&
              result.reviewedScenariosWithReasons &&
              result.scenarioSideEffectsMatchActualFlow &&
              approvalCardsAreWellFormed &&
              userDecisionsWereRecorded &&
              result.fullAccessFileExists &&
              !result.fullAccessHasApprovalEvent &&
              !result.fullAccessApprovalCardVisible &&
              result.fullAccessReviewCallCount === 0 &&
              result.composerPermissionAfterFullAccessSend.includes('审核'),
            {
              name: 'workbench-terminal-review-real-multi-run-flows',
              message:
                '只读查询应绕过审核；写入命令须记录真实 AI 审核及 reason。每轮是否进入人工审批由真实模型决定：出现卡片时验证真实同意、拒绝或指导流程及其副作用；未出现时不伪造审批。完全访问应跳过两层审核。',
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
