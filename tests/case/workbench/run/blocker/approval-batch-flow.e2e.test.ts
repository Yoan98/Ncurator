import { createHash } from 'node:crypto'
import { access, lstat, mkdir, readFile, readdir, readlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import { describe, it } from 'vitest'
import type {
  AiApprovalBatchDecision,
  AiApprovalBatchItem,
  AiLlmIoRecord,
  AiRunEvent
} from '../../../../../src/shared/types'
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
  readWorkbenchExecutionPermissionSelection,
  sendWorkbenchMessage,
  selectWorkbenchExecutionPermission,
  selectWorkbenchWorkspace,
  setupWorkbenchWithTempWorkspace,
  waitForLatestAssistantProcess,
  waitForWorkbenchAiEvent,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'approval-batch-flow'
const TERMINAL_REVIEW_OUTCOME_TIMEOUT_MS = 120_000
const IS_WINDOWS = process.platform === 'win32'
const TEST_FILE_CONTENTS = {
  cache: 'temporary-cache-file-for-approval-e2e\n',
  keep: 'temporary-preserved-file-for-approval-e2e\n'
} as const
const GUIDE_MESSAGE =
  '不要执行删除，也不要改用其他命令。只说明这条命令会影响哪些文件，以及影响范围。'

type WorkspaceSnapshot = Record<string, string>

const exists = async (filePath: string): Promise<boolean> =>
  await access(filePath)
    .then(() => true)
    .catch(() => false)

const readTextIfExists = async (filePath: string): Promise<string | null> =>
  await readFile(filePath, 'utf8').catch((error: unknown) => {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    ) {
      return null
    }
    throw error
  })

const snapshotWorkspace = async (rootPath: string): Promise<WorkspaceSnapshot> => {
  const snapshot: WorkspaceSnapshot = {}
  const visit = async (directoryPath: string): Promise<void> => {
    const entries = (await readdir(directoryPath, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name)
    )
    for (const entry of entries) {
      const entryPath = path.join(directoryPath, entry.name)
      const relativePath = path.relative(rootPath, entryPath).split(path.sep).join('/')
      const details = await lstat(entryPath)
      if (details.isSymbolicLink()) {
        snapshot[relativePath] = 'symlink:' + (await readlink(entryPath))
      } else if (details.isDirectory()) {
        snapshot[relativePath] = 'directory'
        await visit(entryPath)
      } else if (details.isFile()) {
        const digest = createHash('sha256')
          .update(await readFile(entryPath))
          .digest('hex')
        snapshot[relativePath] = 'file:' + digest
      } else {
        snapshot[relativePath] = 'other:' + details.mode
      }
    }
  }
  await visit(rootPath)
  return snapshot
}

const changedWorkspacePaths = (before: WorkspaceSnapshot, after: WorkspaceSnapshot): string[] =>
  Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
    .filter((relativePath) => before[relativePath] !== after[relativePath])
    .sort()

const areChangesWithinDirectory = (
  relativePaths: readonly string[],
  directoryPath: string
): boolean => {
  const normalizedDirectory = directoryPath.split(path.sep).join('/')
  return relativePaths.every(
    (relativePath) =>
      relativePath === normalizedDirectory || relativePath.startsWith(normalizedDirectory + '/')
  )
}

const quoteShellPath = (filePath: string): string =>
  IS_WINDOWS
    ? "'" + filePath.replaceAll("'", "''") + "'"
    : "'" + filePath.replaceAll("'", "'\\''") + "'"

const matchesExpectedTerminalCommand = (command: string, expectedCommand: string): boolean => {
  if (command === expectedCommand) return true
  if (!IS_WINDOWS) return false
  const powershellWrapper = command
    .trim()
    .match(/^powershell(?:\.exe)?\s+-NoProfile\s+-Command\s+"([\s\S]*)"$/iu)
  return powershellWrapper?.[1] === expectedCommand
}

const buildPendingDeletionRequest = (command: string): string =>
  [
    '请调用 terminal_run 提交下面这条完整清理命令，不要改写或拆分。',
    '维护命令：',
    command,
    '命令会递归删除整个目标目录及全部内容。当前尚未授权删除，必须先由我在人工审批卡决定。请实际提交工具调用，仅展示命令不算完成。',
    '收到允许后执行并说明结果。收到拒绝或指导后按反馈处理，不改用替代删除命令，不再询问删除范围。'
  ].join('\n')

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
  reviewInputIncludesExpectedCommand: boolean
}

const readTerminalReviewDecisions = (
  records: readonly AiLlmIoRecord[],
  runId: string,
  expectedCommand: string
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
        return [
          {
            commandId,
            decision,
            reason,
            reviewInputIncludesExpectedCommand: record.user.includes(expectedCommand)
          }
        ]
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

const waitForScenarioCompletion = async (input: {
  runtime: Parameters<typeof collectWorkbenchAiRunEvents>[0]
  page: Page
  runId: string
  startedAtMs: number
  modelName: string
  expectedCommand: string
}): Promise<Awaited<ReturnType<typeof waitForWorkbenchAiRunCompletion>>> => {
  const deadline = Date.now() + WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  for (;;) {
    const runEvents = (await collectWorkbenchAiRunEvents(input.runtime)).filter(
      (event) => event.runId === input.runId
    )
    const resolvedInteractionIds = new Set([
      ...runEvents.flatMap((event) =>
        event.type === 'human_interaction_resolved' ? [event.interactionId] : []
      )
    ])
    const interaction = runEvents.find(
      (event): event is Extract<AiRunEvent, { type: 'human_interaction_required' }> =>
        event.type === 'human_interaction_required' &&
        !resolvedInteractionIds.has(event.interactionId)
    )
    const pendingApproval = runEvents
      .filter(isApprovalBatchRequiredEvent)
      .find(
        (approval) =>
          !runEvents.some(
            (event) =>
              event.type === 'approval_batch_decision' && event.batchId === approval.batchId
          )
      )
    const runFailed = runEvents.find(
      (event): event is Extract<AiRunEvent, { type: 'run_failed' }> => event.type === 'run_failed'
    )
    const runCancelled = runEvents.some((event) => event.type === 'run_cancelled')
    const terminalCommands = runEvents.flatMap((event) =>
      event.type === 'terminal_step_started' ? [event.command] : []
    )

    if (interaction || pendingApproval || runFailed || runCancelled) {
      const reviewDecisions = readTerminalReviewDecisions(
        await collectWorkbenchLlmIoRecords(input.runtime),
        input.runId,
        input.expectedCommand
      )
      throw new Error(
        'run did not settle through the expected approval flow: ' +
          JSON.stringify({
            interaction: interaction?.interaction,
            pendingApproval: pendingApproval?.items,
            runFailed: runFailed?.message,
            runCancelled,
            terminalCommands,
            reviewDecisions
          })
      )
    }

    if (runEvents.some((event) => event.type === 'run_completed')) {
      return await waitForWorkbenchAiRunCompletion(
        input.runtime,
        input.startedAtMs,
        input.modelName,
        undefined,
        { page: input.page, blockerPolicy: 'fail' }
      )
    }

    if (Date.now() >= deadline) {
      throw new Error(
        'run timed out before completion: ' +
          JSON.stringify({ runId: input.runId, terminalCommands })
      )
    }
    await input.page.waitForTimeout(500)
  }
}

type TerminalReviewObserverSnapshot = {
  activityId: string
  headerText: string
  itemIds: string[]
  itemTexts: string[]
  headerHasShimmer: boolean
  itemHasShimmer: boolean
}

type TerminalReviewObserverState = {
  snapshots: TerminalReviewObserverSnapshot[]
  observer?: MutationObserver
  capture?: () => void
}

type TerminalReviewObserverWindow = Window & {
  __terminalReviewObserver?: TerminalReviewObserverState
}

type TerminalReviewRowSnapshot = {
  itemId: string
  state: string | null
  text: string
  reviewResultText: string
  reviewResultRailClass: string
  color: string
  headerColor: string
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
  pendingTerminalCommandTexts: string[]
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
      (await getWorkbenchLocator(page, chatSelectors.approvalBatchSubmitButton).isVisible()),
    pendingTerminalCommandTexts: await processRoot
      .locator('[data-terminal-review-state="waiting_approval"]')
      .allTextContents()
  }
}

const installTerminalReviewObserver = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const state: TerminalReviewObserverState = { snapshots: [] }
    const scan = (): void => {
      const panels = document.querySelectorAll<HTMLElement>('[data-terminal-reviewing="true"]')
      for (const panel of panels) {
        const activityId = panel.getAttribute('data-testid')
        if (!activityId || state.snapshots.some((snapshot) => snapshot.activityId === activityId)) {
          continue
        }
        const items = Array.from(
          panel.querySelectorAll<HTMLElement>('[data-terminal-review-state="reviewing"]')
        )
        state.snapshots.push({
          activityId,
          headerText: panel.querySelector(':scope > summary')?.textContent?.trim() || '',
          itemIds: items.flatMap((item) => {
            const id = item.getAttribute('data-process-item-id')
            return id ? [id] : []
          }),
          itemTexts: items.map((item) => item.textContent?.trim() || ''),
          headerHasShimmer: Boolean(
            panel.querySelector(':scope > summary .workbench-thinking-shimmer')
          ),
          itemHasShimmer: items.some((item) => item.querySelector('.workbench-thinking-shimmer'))
        })
      }
    }
    state.capture = scan
    state.observer = new MutationObserver(scan)
    ;(window as TerminalReviewObserverWindow).__terminalReviewObserver = state
    state.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    })
    scan()
  })
}

const stopTerminalReviewObserver = async (page: Page): Promise<TerminalReviewObserverSnapshot[]> =>
  page.evaluate(() => {
    const state = (window as TerminalReviewObserverWindow).__terminalReviewObserver
    state?.capture?.()
    state?.observer?.disconnect()
    return state?.snapshots || []
  })

const readTerminalReviewRows = async (page: Page): Promise<TerminalReviewRowSnapshot[]> => {
  const processRoot = await waitForLatestAssistantProcess(page)
  const processToggle = getWorkbenchPrefixLocator(
    page,
    workbenchSelectors.assistantProcessTogglePrefix
  ).last()
  if ((await processToggle.getAttribute('aria-expanded')) === 'false') {
    await processToggle.click()
  }
  return await processRoot.locator('[data-process-item-id]').evaluateAll((elements) =>
    elements.map((element) => ({
      itemId: element.getAttribute('data-process-item-id') || '',
      state: element.getAttribute('data-terminal-review-state'),
      text: element.textContent?.trim() || '',
      reviewResultText:
        element
          .querySelector('[data-testid="workbench-assistant-review-result-rail"]')
          ?.textContent?.trim() || '',
      reviewResultRailClass:
        element
          .querySelector('[data-testid="workbench-assistant-review-result-rail"]')
          ?.getAttribute('class') || '',
      color: getComputedStyle(element).color,
      headerColor: getComputedStyle(
        element.closest('details')?.querySelector(':scope > summary > span') || element
      ).color
    }))
  )
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

type TerminalScenarioAction = 'auto_approve' | 'approve' | 'reject' | 'guide'

type TerminalStepResult = {
  command: string
  executionStatus: 'completed' | 'cancelled'
  exitCode: number | null
  timedOut: boolean
}

type TerminalScenarioResult = {
  runId: string
  action: TerminalScenarioAction
  expectedCommand: string
  reviewCallCount: number
  reviewDecisions: TerminalReviewDecision[]
  approvalBatchRequiredCount: number
  approvalItems: AiApprovalBatchItem[]
  approvalDecisions: AiApprovalBatchDecision[]
  unexpectedApprovalRejected: boolean
  approvalWaiting: Awaited<ReturnType<typeof readApprovalWaitingSnapshot>> | null
  reviewUiObservations: TerminalReviewObserverSnapshot[]
  reviewStartedCommandIds: string[]
  reviewResolvedCommandIds: string[]
  reviewResolvedBeforeFirstExecution: boolean
  terminalReviewRows: TerminalReviewRowSnapshot[]
  reviewedItemTexts: string[]
  restoredTerminalReviewRows: TerminalReviewRowSnapshot[]
  restoredReviewedItemTexts: string[]
  terminalCommandsStarted: string[]
  terminalResults: TerminalStepResult[]
  changedWorkspacePaths: string[]
  outputPathExists: boolean
  inspectedFileContents: Array<{ path: string; contents: string | null }>
}

type HumanInteractionRequiredEvent = Extract<AiRunEvent, { type: 'human_interaction_required' }>

const answerFullAccessPathQuestion = async (input: {
  runtime: Parameters<typeof collectWorkbenchAiRunEvents>[0]
  page: Page
  runId: string
  workspaceRoot: string
  event: HumanInteractionRequiredEvent
}): Promise<string> => {
  if (
    input.event.interaction.kind !== 'question' ||
    input.event.interaction.questions.length !== 1
  ) {
    throw new Error(
      'full access write produced an unexpected question: ' +
        JSON.stringify(input.event.interaction)
    )
  }
  const question = input.event.interaction.questions[0]
  if (!question) throw new Error('full access path question is missing')
  const questionEvidence = [
    question.question,
    ...question.options.flatMap((option) => [option.label, option.description])
  ].join('\n')
  if (!/approval-full-access\.txt/iu.test(questionEvidence)) {
    throw new Error(
      'full access question did not concern the target file path: ' +
        JSON.stringify(input.event.interaction)
    )
  }
  const workspaceDirectoryName = path.basename(input.workspaceRoot)
  const workspaceOption = question.options.find((option) => {
    const optionText = option.id + ' ' + option.label + ' ' + option.description
    return (
      (/当前工作区|use_workspace/iu.test(optionText) ||
        optionText.includes(workspaceDirectoryName)) &&
      !/工作区之外|原路径创建/iu.test(optionText)
    )
  })
  if (!workspaceOption) {
    throw new Error(
      'full access question did not offer the actual workspace path: ' + JSON.stringify(question)
    )
  }

  const card = input.page.getByTestId(workbenchSelectors.humanQuestionCard)
  await card.waitFor({ state: 'visible', timeout: 30_000 })
  await card
    .getByTestId(`workbench-human-question-option-${question.id}-${workspaceOption.id}`)
    .click()
  await card.getByTestId(workbenchSelectors.humanQuestionSubmit).click()
  const resolved = await waitForWorkbenchAiEvent(input.runtime, {
    name: 'approval_full_access_path_question_resolved',
    matches: (candidate) =>
      candidate.type === 'human_interaction_resolved' &&
      candidate.runId === input.runId &&
      candidate.interactionId === input.event.interactionId
  })
  if (resolved.type !== 'human_interaction_resolved') {
    throw new Error('full access path question was not resolved')
  }
  return input.event.interactionId
}

const waitForFullAccessRunCompletion = async (input: {
  runtime: Parameters<typeof collectWorkbenchAiRunEvents>[0]
  page: Page
  runId: string
  workspaceRoot: string
}): Promise<void> => {
  const resolvedInteractionIds = new Set<string>()
  const deadline = Date.now() + WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  for (;;) {
    const runEvents = (await collectWorkbenchAiRunEvents(input.runtime)).filter(
      (event) => event.runId === input.runId
    )
    const resolvedByRun = new Set(
      runEvents.flatMap((event) =>
        event.type === 'human_interaction_resolved' ? [event.interactionId] : []
      )
    )
    const pendingQuestion = runEvents.find(
      (event): event is HumanInteractionRequiredEvent =>
        event.type === 'human_interaction_required' &&
        !resolvedInteractionIds.has(event.interactionId) &&
        !resolvedByRun.has(event.interactionId)
    )
    if (pendingQuestion) {
      if (resolvedInteractionIds.size >= 2) {
        throw new Error(
          'full access write asked for repeated clarification: ' +
            JSON.stringify(pendingQuestion.interaction)
        )
      }
      resolvedInteractionIds.add(
        await answerFullAccessPathQuestion({
          runtime: input.runtime,
          page: input.page,
          runId: input.runId,
          workspaceRoot: input.workspaceRoot,
          event: pendingQuestion
        })
      )
      continue
    }
    if (runEvents.some((event) => event.type === 'run_completed')) return
    const failure = runEvents.find(
      (event): event is Extract<AiRunEvent, { type: 'run_failed' }> => event.type === 'run_failed'
    )
    if (failure) throw new Error('full access write failed: ' + failure.message)
    if (runEvents.some((event) => event.type === 'run_cancelled')) {
      throw new Error('full access write was cancelled')
    }
    if (Date.now() >= deadline) throw new Error('full access write did not complete in time')
    await input.page.waitForTimeout(500)
  }
}

const runTerminalScenario = async (input: {
  runtime: Parameters<typeof collectWorkbenchAiRunEvents>[0]
  page: Page
  modelName: string
  name: string
  inputIncludes: string
  userMessage: string
  workspaceRoot: string
  outputPath: string
  expectedCommand: string
  inspectedFilePaths?: readonly string[]
  action: TerminalScenarioAction
  guideMessage?: string
}): Promise<TerminalScenarioResult> => {
  const workspaceBefore = await snapshotWorkspace(input.workspaceRoot)
  const startedAtMs = Date.now()
  await installTerminalReviewObserver(input.page)
  await sendWorkbenchMessage(input.page, input.userMessage)
  const runStarted = await waitForWorkbenchAiEvent(input.runtime, {
    name: input.name + '_run_started',
    matches: (event) => isRunStartedEvent(event) && event.input.includes(input.inputIncludes)
  })
  if (!isRunStartedEvent(runStarted)) throw new Error(input.name + ' run did not start')

  const outcome = await waitForTerminalReviewOutcome(input.runtime, runStarted.runId, input.name)
  if (outcome.type === 'human_interaction_required') {
    throw new Error(
      input.name +
        ' asked a question instead of submitting the operation for review: ' +
        JSON.stringify(outcome.interaction)
    )
  }
  const reviewUiObservations = await stopTerminalReviewObserver(input.page)
  const llmRecords = await collectWorkbenchLlmIoRecords(input.runtime)
  const runLlmRecords = llmRecords.filter((record) => record.runId === runStarted.runId)
  const reviewCallCount = runLlmRecords.filter(
    (record) => record.caller === 'human.terminal_review'
  ).length
  const reviewDecisions = readTerminalReviewDecisions(
    llmRecords,
    runStarted.runId,
    input.expectedCommand
  )
  const approvalEvent = isApprovalBatchRequiredEvent(outcome) ? outcome : null
  let approvalWaiting: TerminalScenarioResult['approvalWaiting'] = null
  let unexpectedApprovalRejected = false
  let approvalDecisions: AiApprovalBatchDecision[] = []

  if (approvalEvent) {
    await getApprovalCard(input.page).waitFor({ state: 'visible', timeout: 30_000 })
    approvalWaiting = await readApprovalWaitingSnapshot(input.page)

    const approvalItem = approvalEvent.items.length === 1 ? approvalEvent.items[0] : undefined
    const matchingReviews = approvalItem
      ? reviewDecisions.filter(
          (decision) =>
            decision.commandId === approvalItem.itemId &&
            decision.reviewInputIncludesExpectedCommand
        )
      : []
    const matchingReview = matchingReviews.at(-1)
    const approvalMatchesExpectedCommand =
      approvalItem?.toolName === 'terminal_run' &&
      matchesExpectedTerminalCommand(approvalItem.command, input.expectedCommand)
    const approvalHasExpectedReview = Boolean(
      matchingReview &&
      matchingReview.decision === 'needs_human_review' &&
      matchingReview.reason.trim().length > 0 &&
      matchingReview.reviewInputIncludesExpectedCommand
    )
    const canPerformExpectedDecision =
      input.action !== 'auto_approve' && approvalMatchesExpectedCommand && approvalHasExpectedReview

    if (!canPerformExpectedDecision) {
      unexpectedApprovalRejected = true
      const rejected = await decideWorkbenchApprovalBatch(input.runtime, input.page, {
        event: approvalEvent,
        action: 'reject',
        timeoutMs: 30_000
      })
      approvalDecisions = rejected.decisions
    } else if (input.action === 'guide') {
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
          event.batchId === approvalEvent.batchId &&
          event.decisions.some(
            (decision) => decision.itemId === approvalItem?.itemId && decision.action === 'guide'
          )
      })
      if (guideDecision.type !== 'approval_batch_decision') {
        throw new Error(input.name + ' guide decision was not recorded')
      }
      approvalDecisions = guideDecision.decisions
    } else if (input.action === 'approve' || input.action === 'reject') {
      const decision = await decideWorkbenchApprovalBatch(input.runtime, input.page, {
        event: approvalEvent,
        action: input.action
      })
      approvalDecisions = decision.decisions
    } else {
      throw new Error(input.name + ' received an unexpected approval for auto_approve action')
    }
  } else if (outcome.type !== 'run_completed') {
    const detail =
      outcome.type === 'run_failed' ? outcome.type + ': ' + outcome.message : outcome.type
    const runEvents = (await collectWorkbenchAiRunEvents(input.runtime)).filter(
      (event) => event.runId === runStarted.runId
    )
    const terminalCommands = runEvents.flatMap((event) =>
      event.type === 'terminal_step_started' ? [event.command] : []
    )
    throw new Error(
      input.name +
        ' run produced ' +
        detail +
        ': ' +
        JSON.stringify({ reviewDecisions, terminalCommands })
    )
  }

  const evidence = await waitForScenarioCompletion({
    runtime: input.runtime,
    page: input.page,
    runId: runStarted.runId,
    startedAtMs,
    modelName: input.modelName,
    expectedCommand: input.expectedCommand
  })
  recordWorkbenchAiEvidence(input.runtime, evidence, 0.8)

  const runEvents = (await collectWorkbenchAiRunEvents(input.runtime)).filter(
    (event) => event.runId === runStarted.runId
  )
  const reviewStartedEvents = runEvents.filter(
    (event): event is Extract<AiRunEvent, { type: 'terminal_review_started' }> =>
      event.type === 'terminal_review_started'
  )
  const reviewResolvedEvents = runEvents.filter(
    (event): event is Extract<AiRunEvent, { type: 'terminal_review_resolved' }> =>
      event.type === 'terminal_review_resolved'
  )
  const reviewedTerminalStepStartedIndex = runEvents.findIndex(
    (event) =>
      event.type === 'terminal_step_started' &&
      reviewStartedEvents.some((review) =>
        review.commands.some(
          (command) =>
            typeof command.input.command === 'string' &&
            matchesExpectedTerminalCommand(event.command, command.input.command)
        )
      )
  )
  const reviewStartedIndex = runEvents.findIndex(
    (event) => event.type === 'terminal_review_started'
  )
  const reviewResolvedIndex = runEvents.findIndex(
    (event) => event.type === 'terminal_review_resolved'
  )
  const reviewedItemTexts = approvalEvent ? await readApprovalReviewedItemTexts(input.page) : []
  const terminalReviewRows = await readTerminalReviewRows(input.page)
  let restoredReviewedItemTexts: string[] = []
  let restoredTerminalReviewRows: TerminalReviewRowSnapshot[] = []
  if (approvalEvent && input.action === 'guide' && !unexpectedApprovalRejected) {
    await input.page.reload()
    await waitForLatestAssistantProcess(input.page)
    restoredTerminalReviewRows = await readTerminalReviewRows(input.page)
    restoredReviewedItemTexts = await readApprovalReviewedItemTexts(input.page)
  }
  const workspaceAfter = await snapshotWorkspace(input.workspaceRoot)
  const terminalResults = runEvents.flatMap((event): TerminalStepResult[] =>
    event.type === 'terminal_step_result'
      ? [
          {
            command: event.command,
            executionStatus: event.executionStatus,
            exitCode: event.exitCode,
            timedOut: event.timedOut
          }
        ]
      : []
  )

  return {
    runId: runStarted.runId,
    action: input.action,
    expectedCommand: input.expectedCommand,
    reviewCallCount,
    reviewDecisions,
    approvalBatchRequiredCount: runEvents.filter(isApprovalBatchRequiredEvent).length,
    approvalItems: approvalEvent?.items || [],
    approvalDecisions: approvalEvent
      ? approvalDecisions
      : runEvents.flatMap((event) =>
          event.type === 'approval_batch_decision' ? event.decisions : []
        ),
    unexpectedApprovalRejected,
    approvalWaiting,
    reviewUiObservations,
    reviewStartedCommandIds: reviewStartedEvents.flatMap((event) =>
      event.commands.map((command) => command.commandId)
    ),
    reviewResolvedCommandIds: reviewResolvedEvents.flatMap((event) =>
      event.decisions.map((decision) => decision.commandId)
    ),
    reviewResolvedBeforeFirstExecution:
      reviewStartedIndex >= 0 &&
      reviewResolvedIndex > reviewStartedIndex &&
      (reviewedTerminalStepStartedIndex < 0 ||
        reviewResolvedIndex < reviewedTerminalStepStartedIndex),
    terminalReviewRows,
    reviewedItemTexts,
    restoredTerminalReviewRows,
    restoredReviewedItemTexts,
    terminalCommandsStarted: runEvents.flatMap((event) =>
      event.type === 'terminal_step_started' ? [event.command] : []
    ),
    terminalResults,
    changedWorkspacePaths: changedWorkspacePaths(workspaceBefore, workspaceAfter),
    outputPathExists: await exists(input.outputPath),
    inspectedFileContents: await Promise.all(
      (input.inspectedFilePaths || []).map(async (filePath) => ({
        path: filePath,
        contents: await readTextIfExists(filePath)
      }))
    )
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
          const workspaceRoot = setup.workspace.rootPath
          const authorizedDirectory = path.join(workspaceRoot, 'approval-created-dir')
          const fullAccessFile = path.join(workspaceRoot, 'approval-full-access.txt')
          const deleteTargets = {
            approve: {
              directory: path.join(workspaceRoot, 'approval-delete-approve-target')
            },
            reject: {
              directory: path.join(workspaceRoot, 'approval-delete-reject-target')
            },
            guide: {
              directory: path.join(workspaceRoot, 'approval-delete-guide-target')
            }
          }
          const terminalAuthorizedDirectory = IS_WINDOWS
            ? authorizedDirectory.replaceAll('\\', '/')
            : authorizedDirectory
          const makeDirectoryCommand = IS_WINDOWS
            ? 'New-Item -ItemType Directory -Force -Path ' +
              quoteShellPath(terminalAuthorizedDirectory) +
              ' | Out-Null'
            : 'mkdir -p ' + quoteShellPath(authorizedDirectory)
          const listWorkspaceCommand = IS_WINDOWS
            ? 'Get-ChildItem -LiteralPath ' +
              quoteShellPath(workspaceRoot) +
              ' | Select-Object -ExpandProperty Name'
            : 'ls -1 ' + quoteShellPath(workspaceRoot)
          const deleteDirectoryCommand = (directory: string): string =>
            IS_WINDOWS
              ? 'Remove-Item -LiteralPath ' + quoteShellPath(directory) + ' -Recurse -Force'
              : 'rm -rf ' + quoteShellPath(directory)
          const createFileCommand = IS_WINDOWS
            ? 'Set-Content -LiteralPath ' +
              quoteShellPath(fullAccessFile) +
              " -Value 'full-access-by-workbench-e2e'"
            : "printf '%s' 'full-access-by-workbench-e2e' > " + quoteShellPath(fullAccessFile)

          await mkdir(workspaceRoot, { recursive: true })
          await Promise.all(
            Object.values(deleteTargets).map(async ({ directory }) => {
              await mkdir(directory, { recursive: true })
              await Promise.all([
                writeFile(path.join(directory, 'cache.tmp'), TEST_FILE_CONTENTS.cache),
                writeFile(path.join(directory, 'keep.txt'), TEST_FILE_CONTENTS.keep)
              ])
            })
          )

          await selectWorkbenchExecutionPermission(page, '审核')
          const queryWorkspaceBefore = await snapshotWorkspace(workspaceRoot)
          const queryStartedAtMs = Date.now()
          await sendWorkbenchMessage(
            page,
            '请只用终端列出当前工作区根目录的一级名称，不要创建、修改或删除任何文件。请直接运行下面这条原生只读命令，不要用子 shell 包装：\n' +
              listWorkspaceCommand
          )
          const queryRunStarted = await waitForWorkbenchAiEvent(runtime, {
            name: 'approval_readonly_query_run_started',
            matches: (event) =>
              isRunStartedEvent(event) && event.input.includes('列出当前工作区根目录')
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
          const queryWorkspaceAfter = await snapshotWorkspace(workspaceRoot)
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
          const queryChangedWorkspacePaths = changedWorkspacePaths(
            queryWorkspaceBefore,
            queryWorkspaceAfter
          )

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
              '我明确授权你在当前工作区通过终端创建 approval-created-dir 目录。请原样执行这条命令并告诉我结果：\n' +
              makeDirectoryCommand,
            workspaceRoot,
            outputPath: authorizedDirectory,
            expectedCommand: makeDirectoryCommand,
            action: 'auto_approve'
          })

          await startAuditSession()
          const approvePermissionScenario = await runTerminalScenario({
            runtime,
            page,
            modelName: setup.env.modelName,
            name: 'approval_pending_delete_approve',
            inputIncludes: 'approval-delete-approve-target',
            userMessage: buildPendingDeletionRequest(
              deleteDirectoryCommand(deleteTargets.approve.directory)
            ),
            workspaceRoot,
            outputPath: deleteTargets.approve.directory,
            expectedCommand: deleteDirectoryCommand(deleteTargets.approve.directory),
            inspectedFilePaths: [
              path.join(deleteTargets.approve.directory, 'cache.tmp'),
              path.join(deleteTargets.approve.directory, 'keep.txt')
            ],
            action: 'approve'
          })

          await startAuditSession()
          const rejectScenario = await runTerminalScenario({
            runtime,
            page,
            modelName: setup.env.modelName,
            name: 'approval_pending_delete_reject',
            inputIncludes: 'approval-delete-reject-target',
            userMessage: buildPendingDeletionRequest(
              deleteDirectoryCommand(deleteTargets.reject.directory)
            ),
            workspaceRoot,
            outputPath: deleteTargets.reject.directory,
            expectedCommand: deleteDirectoryCommand(deleteTargets.reject.directory),
            inspectedFilePaths: [
              path.join(deleteTargets.reject.directory, 'cache.tmp'),
              path.join(deleteTargets.reject.directory, 'keep.txt')
            ],
            action: 'reject'
          })

          await startAuditSession()
          const guideScenario = await runTerminalScenario({
            runtime,
            page,
            modelName: setup.env.modelName,
            name: 'approval_pending_delete_guide',
            inputIncludes: 'approval-delete-guide-target',
            userMessage: buildPendingDeletionRequest(
              deleteDirectoryCommand(deleteTargets.guide.directory)
            ),
            workspaceRoot,
            outputPath: deleteTargets.guide.directory,
            expectedCommand: deleteDirectoryCommand(deleteTargets.guide.directory),
            inspectedFilePaths: [
              path.join(deleteTargets.guide.directory, 'cache.tmp'),
              path.join(deleteTargets.guide.directory, 'keep.txt')
            ],
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
          await waitForFullAccessRunCompletion({
            runtime,
            page,
            runId: fullAccessRunStarted.runId,
            workspaceRoot
          })
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
          const fullAccessTerminalCommandsStarted = fullAccessEvents.flatMap((event) =>
            event.type === 'terminal_step_started' ? [event.command] : []
          )
          const fullAccessTerminalResults = fullAccessEvents.flatMap((event) =>
            event.type === 'terminal_step_result'
              ? [
                  {
                    command: event.command,
                    executionStatus: event.executionStatus,
                    exitCode: event.exitCode,
                    timedOut: event.timedOut
                  }
                ]
              : []
          )
          const fullAccessApprovalCardVisible = await getApprovalCard(page)
            .isVisible()
            .catch(() => false)

          return {
            queryTerminalStepCount,
            queryReviewCallCount,
            queryHadApprovalEvent: queryEvents.some(isApprovalBatchRequiredEvent),
            queryApprovalCardVisible,
            queryChangedWorkspacePaths,
            createScenario,
            approvePermissionScenario,
            rejectScenario,
            guideScenario,
            deletionTargetPaths: {
              approve: path
                .relative(workspaceRoot, deleteTargets.approve.directory)
                .split(path.sep)
                .join('/'),
              reject: path
                .relative(workspaceRoot, deleteTargets.reject.directory)
                .split(path.sep)
                .join('/'),
              guide: path
                .relative(workspaceRoot, deleteTargets.guide.directory)
                .split(path.sep)
                .join('/')
            },
            fullAccessFileExists: await exists(fullAccessFile),
            fullAccessFileContents: await readTextIfExists(fullAccessFile),
            fullAccessExpectedCommand: createFileCommand,
            fullAccessEvents,
            fullAccessTerminalCommandsStarted,
            fullAccessTerminalResults,
            fullAccessHasApprovalEvent: fullAccessEvents.some(isApprovalBatchRequiredEvent),
            fullAccessApprovalCardVisible,
            fullAccessReviewCallCount,
            composerPermissionAfterFullAccessSend
          }
        },
        assert: async (result, runtime) => {
          const humanScenarios = [
            result.approvePermissionScenario,
            result.rejectScenario,
            result.guideScenario
          ]
          const approvalCardsAreWellFormed = humanScenarios.every((scenario) => {
            if (scenario.approvalBatchRequiredCount !== 1) return false
            const snapshot = scenario.approvalWaiting
            return Boolean(
              snapshot &&
              snapshot.waitingVisible &&
              snapshot.titleText.length > 0 &&
              snapshot.positionText.startsWith('审批 1 /') &&
              snapshot.waitingText.includes('等待用户处理') &&
              snapshot.pendingTerminalCommandTexts.some((text) => text.includes('待你确认命令')) &&
              !snapshot.hasBlockerNotice &&
              !snapshot.hasAssistanceBadge &&
              !snapshot.hasSeparateGuideButton &&
              snapshot.hasGuideInputAndSubmit &&
              !snapshot.antMessageText.includes('需要审核')
            )
          })
          const everyDeleteCommandWasSentForReview = humanScenarios.every((scenario) => {
            const item = scenario.approvalItems[0]
            return Boolean(
              item &&
              scenario.approvalItems.length === 1 &&
              item.toolName === 'terminal_run' &&
              matchesExpectedTerminalCommand(item.command, scenario.expectedCommand) &&
              scenario.reviewDecisions.some(
                (decision) =>
                  decision.commandId === item.itemId &&
                  decision.decision === 'needs_human_review' &&
                  decision.reason.trim().length > 0 &&
                  decision.reviewInputIncludesExpectedCommand
              )
            )
          })
          const reviewLifecycleIsVisibleWithoutDuplicateItems = [
            ...humanScenarios,
            result.createScenario
          ].every((scenario) => {
            const itemId = scenario.approvalItems[0]?.itemId || scenario.reviewStartedCommandIds[0]
            const reviewObservation = scenario.reviewUiObservations.find(
              (snapshot) =>
                snapshot.headerText.includes('正在审核终端命令') &&
                Boolean(itemId && snapshot.itemIds.includes(itemId))
            )
            const matchingRows = scenario.terminalReviewRows.filter((row) => row.itemId === itemId)
            const expectedAiReviewResult =
              scenario.action === 'auto_approve'
                ? 'AI 审核结果：已通过'
                : 'AI 审核结果：需要人工确认'
            const internalReasons = scenario.reviewDecisions
              .filter((decision) => decision.commandId === itemId)
              .map((decision) => decision.reason.trim())
              .filter(Boolean)
            return Boolean(
              itemId &&
              scenario.reviewResolvedBeforeFirstExecution &&
              scenario.reviewStartedCommandIds.includes(itemId) &&
              scenario.reviewResolvedCommandIds.includes(itemId) &&
              reviewObservation?.itemIds.filter((candidate) => candidate === itemId).length === 1 &&
              reviewObservation.headerHasShimmer &&
              !reviewObservation.itemHasShimmer &&
              matchingRows.length === 1 &&
              matchingRows[0]?.reviewResultText.includes(expectedAiReviewResult) &&
              matchingRows[0]?.reviewResultRailClass.includes('border-l') &&
              !internalReasons.some((reason) =>
                matchingRows[0]?.reviewResultText.includes(reason)
              ) &&
              matchingRows[0]?.headerColor !== 'rgb(179, 38, 30)'
            )
          })
          const userDecisionsWereRecorded = humanScenarios.every((scenario) => {
            if (scenario.action === 'auto_approve') return false
            const expectedResult =
              scenario.action === 'approve'
                ? '人工审核结果：已允许'
                : scenario.action === 'reject'
                  ? '人工审核结果：已拒绝'
                  : '人工审核结果：已提供指导：' + GUIDE_MESSAGE
            const expectedItemId = scenario.approvalItems[0]?.itemId
            const reviewedRow = scenario.terminalReviewRows.find(
              (row) => row.itemId === expectedItemId
            )
            const restoredReviewedRow = scenario.restoredTerminalReviewRows.find(
              (row) => row.itemId === expectedItemId
            )
            return (
              expectedItemId !== undefined &&
              scenario.approvalDecisions.some(
                (decision) =>
                  decision.itemId === expectedItemId && decision.action === scenario.action
              ) &&
              scenario.reviewedItemTexts.some((text) => text.includes(expectedResult)) &&
              reviewedRow?.reviewResultText.includes(expectedResult) === true &&
              reviewedRow.reviewResultRailClass.includes('border-l') &&
              reviewedRow.reviewResultText.includes('AI 审核结果：需要人工确认') &&
              (scenario.action !== 'guide' ||
                (scenario.restoredReviewedItemTexts.some((text) => text.includes(expectedResult)) &&
                  restoredReviewedRow?.reviewResultText.includes(expectedResult) === true &&
                  restoredReviewedRow.reviewResultRailClass.includes('border-l')))
            )
          })
          const refusedCommandsAreMarkedUnexecuted = [
            result.rejectScenario,
            result.guideScenario
          ].every((scenario) => {
            const itemId = scenario.approvalItems[0]?.itemId
            const row = scenario.terminalReviewRows.find((item) => item.itemId === itemId)
            const restoredRow = scenario.restoredTerminalReviewRows.find(
              (item) => item.itemId === itemId
            )
            return Boolean(
              row &&
              row.state === 'not_executed' &&
              row.text.includes('命令未执行') &&
              row.color !== 'rgb(179, 38, 30)' &&
              row.headerColor !== 'rgb(179, 38, 30)' &&
              (scenario.action !== 'guide' ||
                (restoredRow?.state === 'not_executed' && restoredRow.text.includes('命令未执行')))
            )
          })
          const hasSuccessfulTerminalResult = (
            commandsStarted: readonly string[],
            terminalResults: readonly TerminalStepResult[],
            command?: string
          ): boolean =>
            terminalResults.some(
              (terminalResult) =>
                commandsStarted.includes(terminalResult.command) &&
                (command === undefined ||
                  matchesExpectedTerminalCommand(terminalResult.command, command)) &&
                terminalResult.executionStatus === 'completed' &&
                terminalResult.exitCode === 0 &&
                !terminalResult.timedOut
            )
          const hasExpectedReviewDecision = (
            scenario: TerminalScenarioResult,
            decision: 'auto_approve' | 'needs_human_review'
          ): boolean => {
            const lastExpectedDecision = scenario.reviewDecisions
              .filter((item) => item.reviewInputIncludesExpectedCommand)
              .at(-1)
            return Boolean(
              lastExpectedDecision &&
              lastExpectedDecision.decision === decision &&
              lastExpectedDecision.reason.trim().length > 0
            )
          }
          const filesArePreserved = (scenario: TerminalScenarioResult): boolean =>
            scenario.outputPathExists &&
            scenario.inspectedFileContents.length === 2 &&
            scenario.inspectedFileContents[0]?.contents === TEST_FILE_CONTENTS.cache &&
            scenario.inspectedFileContents[1]?.contents === TEST_FILE_CONTENTS.keep
          const changesOnlyTouchTarget = (
            scenario: TerminalScenarioResult,
            relativeTargetPath: string
          ): boolean =>
            scenario.changedWorkspacePaths.length > 0 &&
            areChangesWithinDirectory(scenario.changedWorkspacePaths, relativeTargetPath)

          const createScenarioAutoApproved =
            result.createScenario.reviewCallCount > 0 &&
            hasExpectedReviewDecision(result.createScenario, 'auto_approve') &&
            result.createScenario.approvalBatchRequiredCount === 0 &&
            !result.createScenario.unexpectedApprovalRejected &&
            hasSuccessfulTerminalResult(
              result.createScenario.terminalCommandsStarted,
              result.createScenario.terminalResults.filter((terminalResult) =>
                terminalResult.command.includes(result.createScenario.expectedCommand)
              )
            ) &&
            result.createScenario.outputPathExists &&
            result.createScenario.changedWorkspacePaths.length === 1 &&
            result.createScenario.changedWorkspacePaths[0] === 'approval-created-dir'

          const approveScenarioSideEffectsAreScoped =
            !result.approvePermissionScenario.outputPathExists &&
            result.approvePermissionScenario.inspectedFileContents.every(
              (item) => item.contents === null
            ) &&
            changesOnlyTouchTarget(
              result.approvePermissionScenario,
              result.deletionTargetPaths.approve
            )

          const rejectScenarioHasNoEffects =
            !result.rejectScenario.terminalCommandsStarted.some((command) =>
              matchesExpectedTerminalCommand(command, result.rejectScenario.expectedCommand)
            ) &&
            !result.rejectScenario.terminalResults.some((terminalResult) =>
              matchesExpectedTerminalCommand(
                terminalResult.command,
                result.rejectScenario.expectedCommand
              )
            ) &&
            filesArePreserved(result.rejectScenario) &&
            result.rejectScenario.changedWorkspacePaths.length === 0

          const guideScenarioHasNoDeleteEffects =
            !result.guideScenario.terminalCommandsStarted.some((command) =>
              matchesExpectedTerminalCommand(command, result.guideScenario.expectedCommand)
            ) &&
            filesArePreserved(result.guideScenario) &&
            result.guideScenario.changedWorkspacePaths.length === 0

          const fullAccessCommandSucceeded = hasSuccessfulTerminalResult(
            result.fullAccessTerminalCommandsStarted,
            result.fullAccessTerminalResults
          )
          const normalizedFullAccessFileContents = result.fullAccessFileContents?.replace(
            /\r\n/gu,
            '\n'
          )
          const fullAccessFileContentsAreCorrect =
            normalizedFullAccessFileContents === 'full-access-by-workbench-e2e' ||
            normalizedFullAccessFileContents === 'full-access-by-workbench-e2e\n'
          const createScenarioFailureMessage = createScenarioAutoApproved
            ? ''
            : `创建目录轮未满足审核与执行验收：${JSON.stringify({
                expectedCommand: result.createScenario.expectedCommand,
                reviewDecisions: result.createScenario.reviewDecisions,
                approvalItems: result.createScenario.approvalItems,
                terminalCommandsStarted: result.createScenario.terminalCommandsStarted,
                unexpectedApprovalRejected: result.createScenario.unexpectedApprovalRejected
              })}。`

          await runtime.assertThat(
            result.queryTerminalStepCount > 0 &&
              result.queryReviewCallCount === 0 &&
              !result.queryHadApprovalEvent &&
              !result.queryApprovalCardVisible &&
              result.queryChangedWorkspacePaths.length === 0 &&
              createScenarioAutoApproved &&
              everyDeleteCommandWasSentForReview &&
              reviewLifecycleIsVisibleWithoutDuplicateItems &&
              approvalCardsAreWellFormed &&
              userDecisionsWereRecorded &&
              refusedCommandsAreMarkedUnexecuted &&
              !result.approvePermissionScenario.unexpectedApprovalRejected &&
              !result.rejectScenario.unexpectedApprovalRejected &&
              !result.guideScenario.unexpectedApprovalRejected &&
              result.approvePermissionScenario.approvalBatchRequiredCount === 1 &&
              result.rejectScenario.approvalBatchRequiredCount === 1 &&
              result.guideScenario.approvalBatchRequiredCount === 1 &&
              hasExpectedReviewDecision(result.approvePermissionScenario, 'needs_human_review') &&
              hasExpectedReviewDecision(result.rejectScenario, 'needs_human_review') &&
              hasExpectedReviewDecision(result.guideScenario, 'needs_human_review') &&
              hasSuccessfulTerminalResult(
                result.approvePermissionScenario.terminalCommandsStarted,
                result.approvePermissionScenario.terminalResults,
                result.approvePermissionScenario.expectedCommand
              ) &&
              approveScenarioSideEffectsAreScoped &&
              rejectScenarioHasNoEffects &&
              guideScenarioHasNoDeleteEffects &&
              fullAccessCommandSucceeded &&
              result.fullAccessFileExists &&
              fullAccessFileContentsAreCorrect &&
              !result.fullAccessHasApprovalEvent &&
              !result.fullAccessApprovalCardVisible &&
              result.fullAccessReviewCallCount === 0 &&
              result.fullAccessEvents.every(
                (event) =>
                  event.type !== 'terminal_review_started' &&
                  event.type !== 'terminal_review_resolved'
              ) &&
              result.composerPermissionAfterFullAccessSend.includes('审核'),
            {
              name: 'workbench-terminal-review-real-multi-run-flows',
              message:
                createScenarioFailureMessage +
                '只读轮应无文件变化且绕过审核；创建轮应由 AI 审核自动通过并真实创建目录；三个待授权删除轮都必须经 AI 审核转人工，再按 UI 同意、拒绝或指导；完全访问应真实写入且跳过审核。',
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
