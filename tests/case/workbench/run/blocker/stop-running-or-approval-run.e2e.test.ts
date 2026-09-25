import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import type { AiRunEvent } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  collectWorkbenchAiRunEvents,
  getApprovalCard,
  getWorkbenchLocator,
  createWorkbenchNewSession,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForWorkbenchAiEvent,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'stop-running-or-approval-run'
const LONG_RUN_PROMPT =
  '请读取当前工作区所有工作目录资料，写一份至少 2000 字的详细分析，逐项说明证据来源。'
const IS_WINDOWS = process.platform === 'win32'
const CACHE_CONTENTS = 'temporary-cache-file-for-stop-approval-e2e\n'
const KEEP_CONTENTS = 'temporary-preserved-file-for-stop-approval-e2e\n'
const APPROVAL_WAIT_TIMEOUT_MS = 120_000

type HumanInteractionRequiredEvent = Extract<AiRunEvent, { type: 'human_interaction_required' }>
type ReviewShimmerSnapshot = {
  activityId: string
  itemIds: string[]
  headerHasShimmer: boolean
  itemHasShimmer: boolean
}
type ReviewShimmerObserverState = {
  snapshots: ReviewShimmerSnapshot[]
  observer?: MutationObserver
  capture?: () => void
}
type ReviewShimmerObserverWindow = Window & {
  __reviewShimmerObserver?: ReviewShimmerObserverState
}

const quoteCommandPath = (filePath: string): string =>
  IS_WINDOWS
    ? "'" + filePath.replaceAll("'", "''") + "'"
    : "'" + filePath.replaceAll("'", "'\\''") + "'"

const buildDeleteScopeConflictRequest = (command: string): string =>
  [
    '请原样运行下面这条完整维护命令，不要改写或拆分。',
    '维护命令：',
    command,
    '此次清理的目标是只删除目录中的 cache.tmp，并保留 keep.txt。',
    '完成后说明结果。若我在后续审批卡拒绝，请立即停止，不要改用替代删除命令，也不要再次询问删除范围。'
  ].join('\n')

const matchesExpectedTerminalCommand = (command: string, expectedCommand: string): boolean => {
  if (command === expectedCommand) return true
  if (!IS_WINDOWS) return false
  const powershellWrapper = command
    .trim()
    .match(/^powershell(?:\.exe)?\s+-NoProfile\s+-Command\s+"([\s\S]*)"$/iu)
  return powershellWrapper?.[1] === expectedCommand
}

const installReviewShimmerObserver = async (
  page: Parameters<typeof sendWorkbenchMessage>[0]
): Promise<void> => {
  await page.evaluate(() => {
    const state: ReviewShimmerObserverState = { snapshots: [] }
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
          itemIds: items.flatMap((item) => {
            const itemId = item.getAttribute('data-process-item-id')
            return itemId ? [itemId] : []
          }),
          headerHasShimmer: Boolean(
            panel.querySelector(':scope > summary .workbench-thinking-shimmer')
          ),
          itemHasShimmer: items.some((item) => item.querySelector('.workbench-thinking-shimmer'))
        })
      }
    }
    state.capture = scan
    state.observer = new MutationObserver(scan)
    ;(window as ReviewShimmerObserverWindow).__reviewShimmerObserver = state
    state.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    })
    scan()
  })
}

const stopReviewShimmerObserver = async (
  page: Parameters<typeof sendWorkbenchMessage>[0]
): Promise<ReviewShimmerSnapshot[]> =>
  page.evaluate(() => {
    const state = (window as ReviewShimmerObserverWindow).__reviewShimmerObserver
    state?.capture?.()
    state?.observer?.disconnect()
    return state?.snapshots || []
  })

const answerRunAsWrittenQuestion = async (input: {
  runtime: Parameters<typeof collectWorkbenchAiRunEvents>[0]
  page: Parameters<typeof sendWorkbenchMessage>[0]
  runId: string
  event: HumanInteractionRequiredEvent
}): Promise<void> => {
  if (
    input.event.interaction.kind !== 'question' ||
    input.event.interaction.questions.length !== 1
  ) {
    throw new Error(
      'approval scope clarification was not one question: ' +
        JSON.stringify(input.event.interaction)
    )
  }
  const question = input.event.interaction.questions[0]
  if (!question) throw new Error('approval scope clarification question is missing')
  const option = question.options.find((candidate) => {
    const text = candidate.id + ' ' + candidate.label + ' ' + candidate.description
    return /以命令为准|原样执行|原样递归删除|原样删除整个目录|照原命令|按原命令|按命令执行|按命令字面|run.?as.?given|run.?as.?written|run.?as.?is/iu.test(
      text
    )
  })
  if (!option) {
    throw new Error(
      'approval scope clarification has no explicit run-as-written choice: ' +
        JSON.stringify(question)
    )
  }

  const card = input.page.getByTestId(workbenchSelectors.humanQuestionCard)
  await card.waitFor({ state: 'visible', timeout: 30_000 })
  await card.getByTestId(`workbench-human-question-option-${question.id}-${option.id}`).click()
  await card.getByTestId(workbenchSelectors.humanQuestionSubmit).click()
  const resolved = await waitForWorkbenchAiEvent(input.runtime, {
    name: 'approval_scope_clarification_resolved',
    timeoutMs: APPROVAL_WAIT_TIMEOUT_MS,
    matches: (event) =>
      event.type === 'human_interaction_resolved' &&
      event.runId === input.runId &&
      event.interactionId === input.event.interactionId
  })
  if (resolved.type !== 'human_interaction_resolved') {
    throw new Error('approval scope clarification was not recorded')
  }
}

const waitForApprovalGate = async (input: {
  runtime: Parameters<typeof collectWorkbenchAiRunEvents>[0]
  page: Parameters<typeof sendWorkbenchMessage>[0]
  runId: string
}): Promise<Extract<AiRunEvent, { type: 'approval_batch_required' }>> => {
  const deadline = Date.now() + APPROVAL_WAIT_TIMEOUT_MS
  const resolvedInteractionIds = new Set<string>()
  let clarificationCount = 0
  for (;;) {
    const runEvents = (await collectWorkbenchAiRunEvents(input.runtime)).filter(
      (event) => event.runId === input.runId
    )
    const approval = runEvents.find(
      (event): event is Extract<AiRunEvent, { type: 'approval_batch_required' }> =>
        event.type === 'approval_batch_required'
    )
    if (approval) return approval

    for (const event of runEvents) {
      if (event.type === 'human_interaction_resolved') {
        resolvedInteractionIds.add(event.interactionId)
      }
    }
    const question = runEvents.find(
      (event): event is HumanInteractionRequiredEvent =>
        event.type === 'human_interaction_required' &&
        !resolvedInteractionIds.has(event.interactionId)
    )
    if (question) {
      clarificationCount += 1
      if (clarificationCount > 2) {
        throw new Error('approval command asked for repeated clarification')
      }
      await answerRunAsWrittenQuestion({ ...input, event: question })
      resolvedInteractionIds.add(question.interactionId)
      continue
    }

    const terminalEvent = runEvents.find(
      (event) =>
        event.type === 'run_completed' ||
        event.type === 'run_failed' ||
        event.type === 'run_cancelled'
    )
    if (terminalEvent) {
      throw new Error(
        'approval request ended before approval_batch_required: ' +
          JSON.stringify({ terminalEvent, eventTypes: runEvents.map((event) => event.type) })
      )
    }
    if (Date.now() >= deadline) {
      throw new Error(
        'approval_batch_required timed out: ' +
          JSON.stringify({ runId: input.runId, eventTypes: runEvents.map((event) => event.type) })
      )
    }
    await input.page.waitForTimeout(300)
  }
}

const waitForStopButtonOrRunTerminal = async (input: {
  runtime: Parameters<typeof waitForWorkbenchAiEvent>[0]
  page: Parameters<typeof sendWorkbenchMessage>[0]
  runId: string
}): Promise<'stop' | 'completed' | 'failed' | 'cancelled'> => {
  const deadline = Date.now() + 20_000
  const sendButton = getWorkbenchLocator(input.page, workbenchSelectors.sendButton)
  for (;;) {
    const events = await collectWorkbenchAiRunEvents(input.runtime)
    if (events.some((event) => event.type === 'run_completed' && event.runId === input.runId)) {
      return 'completed'
    }
    if (events.some((event) => event.type === 'run_failed' && event.runId === input.runId)) {
      return 'failed'
    }
    if (events.some((event) => event.type === 'run_cancelled' && event.runId === input.runId)) {
      return 'cancelled'
    }
    const label = (await sendButton.getAttribute('aria-label').catch(() => '')) || ''
    if (label.includes('停止')) return 'stop'
    if (Date.now() >= deadline) {
      throw new Error(`run ${input.runId} did not expose stop state or terminal event`)
    }
    await input.page.waitForTimeout(200)
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
        description: '真实长任务和真实审批等待中点击停止，验证运行结束和 UI 恢复。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          await sendWorkbenchMessage(page, LONG_RUN_PROMPT)
          const longRunStarted = await waitForWorkbenchAiEvent(runtime, {
            name: 'run_started_for_stop',
            matches: (event) => event.type === 'run_started' && event.input === LONG_RUN_PROMPT
          })
          const normalRunState = await waitForStopButtonOrRunTerminal({
            runtime,
            page,
            runId: longRunStarted.runId
          })
          const stopLabelDuringRun =
            (await getWorkbenchLocator(page, workbenchSelectors.sendButton)
              .getAttribute('aria-label')
              .catch(() => '')) || ''
          const sessionRunningIndicatorVisible = await page
            .getByLabel('任务运行中')
            .isVisible()
            .catch(() => false)
          if (normalRunState === 'stop') {
            await getWorkbenchLocator(page, workbenchSelectors.sendButton).click()
            await waitForWorkbenchAiEvent(runtime, {
              name: 'run_cancelled',
              matches: (event) =>
                event.type === 'run_cancelled' && event.runId === longRunStarted.runId
            })
          }
          const labelAfterCancel =
            (await getWorkbenchLocator(page, workbenchSelectors.sendButton)
              .getAttribute('aria-label')
              .catch(() => '')) || ''
          const sessionRunningIndicatorHiddenAfterCancel = !(await page
            .getByLabel('任务运行中')
            .isVisible()
            .catch(() => false))

          await page.waitForFunction(
            (testId) => {
              const button = document.querySelector(`[data-testid="${testId}"]`)
              return !(button?.getAttribute('aria-label') || '').includes('停止')
            },
            workbenchSelectors.sendButton,
            { timeout: 10_000 }
          )
          await createWorkbenchNewSession(page)

          const targetDirectory = path.join(setup.workspace.rootPath, 'stop-approval-target')
          await mkdir(targetDirectory, { recursive: true })
          await writeFile(path.join(targetDirectory, 'cache.tmp'), CACHE_CONTENTS, 'utf8')
          await writeFile(path.join(targetDirectory, 'keep.txt'), KEEP_CONTENTS, 'utf8')
          const expectedCommand = IS_WINDOWS
            ? `Remove-Item -LiteralPath ${quoteCommandPath(targetDirectory)} -Recurse -Force`
            : `rm -rf ${quoteCommandPath(targetDirectory)}`
          const approvalPrompt = buildDeleteScopeConflictRequest(expectedCommand)

          await installReviewShimmerObserver(page)
          await sendWorkbenchMessage(page, approvalPrompt)
          const approvalRunStarted = await waitForWorkbenchAiEvent(runtime, {
            name: 'approval_run_started',
            matches: (event) => event.type === 'run_started' && event.input === approvalPrompt
          })
          const approvalEvent = await waitForApprovalGate({
            runtime,
            page,
            runId: approvalRunStarted.runId
          })
          const approvalItemMatchesCommand = approvalEvent.items.some(
            (item) =>
              item.toolName === 'terminal_run' &&
              matchesExpectedTerminalCommand(item.command, expectedCommand)
          )
          if (!approvalItemMatchesCommand) {
            throw new Error(
              'approval batch did not contain the requested delete command: ' +
                JSON.stringify(approvalEvent.items)
            )
          }
          const reviewShimmerObservations = await stopReviewShimmerObserver(page)
          const reviewedItemIds = approvalEvent.items.map((item) => item.itemId)
          const reviewShimmerIsHeaderOnly = reviewShimmerObservations.some(
            (snapshot) =>
              snapshot.headerHasShimmer &&
              !snapshot.itemHasShimmer &&
              snapshot.itemIds.some((itemId) => reviewedItemIds.includes(itemId))
          )
          await getApprovalCard(page).waitFor({ state: 'visible', timeout: 30_000 })
          await page.waitForFunction(
            (testId) => {
              const button = document.querySelector(`[data-testid="${testId}"]`)
              return button?.getAttribute('aria-label')?.includes('停止') ?? false
            },
            workbenchSelectors.sendButton,
            { timeout: 10_000 }
          )
          const stopButton = getWorkbenchLocator(page, workbenchSelectors.sendButton)
          const stopButtonVisibleDuringApproval = await stopButton.isVisible().catch(() => false)
          const stopLabelDuringApproval = stopButtonVisibleDuringApproval
            ? (await stopButton.getAttribute('aria-label')) || ''
            : ''
          const ordinaryInputVisibleDuringApproval = await getWorkbenchLocator(
            page,
            workbenchSelectors.input
          )
            .isVisible()
            .catch(() => false)

          if (!stopButtonVisibleDuringApproval) {
            throw new Error('approval card appeared without a stop button')
          }
          await stopButton.click()
          const approvalCancelled = await waitForWorkbenchAiEvent(runtime, {
            name: 'approval_run_cancelled',
            matches: (event) =>
              event.type === 'run_cancelled' && event.runId === approvalRunStarted.runId
          })
          if (approvalCancelled.type !== 'run_cancelled') {
            throw new Error('approval cancellation did not reach the cancelled state')
          }
          await page.waitForFunction(
            (testId) => document.querySelectorAll(`[data-testid="${testId}"]`).length === 0,
            workbenchSelectors.assistantApprovalWaiting,
            { timeout: 10_000 }
          )

          const approvalRunEvents = (await collectWorkbenchAiRunEvents(runtime)).filter(
            (event) => event.runId === approvalRunStarted.runId
          )
          const deleteCommandStartedCount = approvalRunEvents.filter(
            (event) =>
              event.type === 'terminal_step_started' &&
              matchesExpectedTerminalCommand(event.command, expectedCommand)
          ).length
          const cacheContentsAfterCancel = await readFile(
            path.join(targetDirectory, 'cache.tmp'),
            'utf8'
          ).catch(() => null)
          const keepContentsAfterCancel = await readFile(
            path.join(targetDirectory, 'keep.txt'),
            'utf8'
          ).catch(() => null)
          const failureCardCountAfterCancel = await page
            .locator(`[data-testid^="${workbenchSelectors.assistantRunFailurePrefix}-"]`)
            .count()

          return {
            normalRunState,
            stopLabelDuringRun,
            labelAfterCancel,
            sessionRunningIndicatorVisible,
            sessionRunningIndicatorHiddenAfterCancel,
            approvalRunEventTypes: approvalRunEvents.map((event) => event.type),
            approvalItemMatchesCommand,
            reviewShimmerObservations,
            reviewShimmerIsHeaderOnly,
            stopButtonVisibleDuringApproval,
            stopLabelDuringApproval,
            ordinaryInputVisibleDuringApproval,
            waitingForUserCountAfterCancel: await page
              .getByTestId(workbenchSelectors.assistantApprovalWaiting)
              .count(),
            deleteCommandStartedCount,
            cacheContentsAfterCancel,
            keepContentsAfterCancel,
            failureCardCountAfterCancel
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            ['stop', 'completed'].includes(result.normalRunState) &&
              (result.normalRunState === 'completed' ||
                result.stopLabelDuringRun.includes('停止')) &&
              (result.normalRunState === 'completed' ||
                (!result.labelAfterCancel.includes('停止') &&
                  result.sessionRunningIndicatorVisible &&
                  result.sessionRunningIndicatorHiddenAfterCancel)) &&
              result.approvalRunEventTypes.includes('approval_batch_required') &&
              result.approvalRunEventTypes.includes('run_cancelled') &&
              result.approvalItemMatchesCommand &&
              result.reviewShimmerIsHeaderOnly &&
              result.stopButtonVisibleDuringApproval &&
              result.stopLabelDuringApproval.includes('停止') &&
              !result.ordinaryInputVisibleDuringApproval &&
              result.waitingForUserCountAfterCancel === 0 &&
              result.deleteCommandStartedCount === 0 &&
              result.cacheContentsAfterCancel === CACHE_CONTENTS &&
              result.keepContentsAfterCancel === KEEP_CONTENTS &&
              result.failureCardCountAfterCancel === 0,
            {
              name: 'workbench-stop-running-and-approval-real',
              message:
                '普通运行中发送按钮应切换为停止并可取消；只有收到真实审批事件并看到审批卡后才验证审批等待中的停止入口。取消应清除等待状态，不执行待审删除命令，并保留目标文件。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
