import { describe, it } from 'vitest'
import type { Locator, Page } from 'playwright'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  collectWorkbenchAiRunEvents,
  createPartnerThroughWorkbenchUi,
  getWorkbenchLocator,
  navigateToWorkbench,
  sendWorkbenchMessage,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'
import type { AiRunEvent } from '../../../../../src/shared/types'

const CASE_ID = 'llm-retry-process-row'
const PARTNER_NAME = 'LLM Retry Process'
const FREE_9B_OPTION_ID = 'free-glm-4-9b'
const PROMPT = '你好'
const OBSERVE_MS = 180_000
const RETRY_HEADING_RE =
  /正在重试\s*\d+\s*\/\s*\d+|已重试\s*\d+\s*\/\s*\d+|重试失败\s*\d+\s*\/\s*\d+|部分重试失败\s*\d+\s*\/\s*\d+/u

const processRootLocator = (page: Page): Locator =>
  page
    .locator(
      `[data-testid^="${workbenchSelectors.assistantProcessPrefix}-"]:not([data-testid^="${workbenchSelectors.assistantProcessItemPrefix}-"])`
    )
    .last()

const sampleProcessText = async (page: Page): Promise<string> =>
  ((await processRootLocator(page).textContent().catch(() => '')) || '').trim().slice(0, 400)

const summarizeEvents = (events: AiRunEvent[]) => {
  const timeline = events
    .filter((event) => {
      if (event.type === 'assistant_process_group_started') {
        return event.kind === 'retry' || event.kind === 'thinking' || event.kind === 'tool'
      }
      if (
        event.type === 'assistant_process_group_completed' ||
        event.type === 'assistant_process_group_failed'
      ) {
        return true
      }
      return (
        event.type === 'assistant_brain_stream_started' ||
        event.type === 'assistant_brain_stream_completed' ||
        event.type === 'assistant_brain_stream_classified' ||
        event.type === 'activity' ||
        event.type === 'human_step' ||
        event.type === 'run_started' ||
        event.type === 'run_completed' ||
        event.type === 'run_failed' ||
        event.type === 'run_cancelled' ||
        event.type === 'answer_completed' ||
        event.type === 'approval_batch_required'
      )
    })
    .map((event) => {
      const at = 'createdAt' in event ? event.createdAt : undefined
      if (event.type === 'assistant_process_group_started' && event.display.kind === 'retry') {
        return {
          at,
          type: event.type,
          kind: event.kind,
          attempt: event.display.attempt,
          maxAttempts: event.display.maxAttempts,
          message: event.display.message.slice(0, 180)
        }
      }
      if (event.type === 'assistant_process_group_started' && event.display.kind === 'tool') {
        return {
          at,
          type: event.type,
          kind: event.kind,
          toolName: event.display.toolName
        }
      }
      if (event.type === 'assistant_process_group_started') {
        return { at, type: event.type, kind: event.kind }
      }
      if (event.type === 'assistant_brain_stream_completed') {
        return {
          at: event.completedAt,
          type: event.type,
          role: event.role,
          text: event.text.slice(0, 80)
        }
      }
      if (event.type === 'activity') {
        return {
          at,
          type: event.type,
          actionType: event.actionType,
          status: event.status,
          summary: event.summary.slice(0, 160)
        }
      }
      if (event.type === 'human_step') {
        return {
          at,
          type: event.type,
          action: event.action,
          toolName: event.toolName,
          summary: event.summary.slice(0, 120)
        }
      }
      if (event.type === 'run_failed') {
        return { at, type: event.type, message: event.message.slice(0, 200) }
      }
      return { at, type: event.type }
    })

  const retryStarts = events.filter(
    (
      event
    ): event is Extract<AiRunEvent, { type: 'assistant_process_group_started' }> =>
      event.type === 'assistant_process_group_started' &&
      event.display.kind === 'retry'
  )
  const retryAttempts = retryStarts.map((event) => event.display.attempt)
  const retryMessages = [
    ...new Set(retryStarts.map((event) => event.display.message.slice(0, 180)))
  ]
  const brainRounds = events.filter((event) => event.type === 'assistant_brain_stream_started')
    .length
  const brainRoles = events
    .filter(
      (
        event
      ): event is Extract<AiRunEvent, { type: 'assistant_brain_stream_completed' }> =>
        event.type === 'assistant_brain_stream_completed'
    )
    .map((event) => event.role)
  const toolNames = events
    .filter(
      (
        event
      ): event is Extract<AiRunEvent, { type: 'assistant_process_group_started' }> =>
        event.type === 'assistant_process_group_started' && event.display.kind === 'tool'
    )
    .map((event) => event.display.toolName)
  const llmActivities = events.filter(
    (event): event is Extract<AiRunEvent, { type: 'activity' }> =>
      event.type === 'activity' && event.actionType.startsWith('llm_')
  )
  const retryRestartCount = retryAttempts.filter((attempt, index) => {
    if (attempt !== 1) return false
    return retryAttempts.slice(0, index).some((previous) => previous > 1)
  }).length

  return {
    eventCount: events.length,
    timeline,
    retryAttempts,
    retryRestartCount,
    retryMessages,
    retryStarted: retryStarts.length,
    retryCompleted: events.filter(
      (event) =>
        event.type === 'assistant_process_group_completed' &&
        event.groupId.endsWith(':llm-retry')
    ).length,
    retryFailed: events.filter(
      (event) =>
        event.type === 'assistant_process_group_failed' && event.groupId.endsWith(':llm-retry')
    ).length,
    brainRounds,
    brainRoles,
    toolNames,
    llmStarted: llmActivities.filter((event) => event.status === 'started').length,
    llmCompleted: llmActivities.filter((event) => event.status === 'completed').length,
    llmFailed: llmActivities.filter((event) => event.status === 'failed').length,
    llmFailedSummaries: llmActivities
      .filter((event) => event.status === 'failed')
      .map((event) => event.summary.slice(0, 160)),
    terminalTypes: [
      ...new Set(
        events
          .filter((event) =>
            ['run_completed', 'run_failed', 'run_cancelled', 'answer_completed'].includes(
              event.type
            )
          )
          .map((event) => event.type)
      )
    ]
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
        groups: ['process'],
        description:
          '用免费 GLM-4 9B 发送你好，采集重试行反复从 1/5 开始且 run 收不掉的事件时间线。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await navigateToWorkbench(page, { waitForSessionListText: false })
          await createPartnerThroughWorkbenchUi(page, PARTNER_NAME)
          const modelSelect = getWorkbenchLocator(page, workbenchSelectors.modelSelect)
          await modelSelect.click()
          const freeOption = page.getByTestId(
            `${workbenchSelectors.modelSelectFreeOptionPrefix}-${FREE_9B_OPTION_ID}`
          )
          await freeOption.waitFor({ state: 'visible', timeout: 60_000 })
          await freeOption.click()
          const startedAtMs = Date.now()
          await sendWorkbenchMessage(page, PROMPT)
          const uiSamples: Array<{ elapsedMs: number; text: string }> = []
          let outcome: 'completed' | 'failed' | 'cancelled' | 'timeout' = 'timeout'
          const deadline = Date.now() + OBSERVE_MS
          while (Date.now() < deadline) {
            const events = await collectWorkbenchAiRunEvents(runtime)
            const runEvents = events.filter((event) => event.createdAt >= startedAtMs)
            uiSamples.push({
              elapsedMs: Date.now() - startedAtMs,
              text: await sampleProcessText(page)
            })
            if (runEvents.some((event) => event.type === 'run_completed')) {
              outcome = 'completed'
              break
            }
            if (runEvents.some((event) => event.type === 'run_failed')) {
              outcome = 'failed'
              break
            }
            if (runEvents.some((event) => event.type === 'run_cancelled')) {
              outcome = 'cancelled'
              break
            }
            const approval = runEvents
              .filter(
                (
                  event
                ): event is Extract<AiRunEvent, { type: 'approval_batch_required' }> =>
                  event.type === 'approval_batch_required'
              )
              .at(-1)
            if (approval) {
              const alreadyDecided = runEvents.some(
                (event) =>
                  event.type === 'approval_batch_decision' && event.batchId === approval.batchId
              )
              if (!alreadyDecided) {
                const approve = page.getByTestId('chat-approval-batch-approve-button')
                if (await approve.isVisible().catch(() => false)) {
                  await approve.click()
                }
              }
            }
            await page.waitForTimeout(2_000)
          }
          if (outcome === 'timeout') {
            const sendButton = getWorkbenchLocator(page, workbenchSelectors.sendButton)
            const label = (await sendButton.getAttribute('aria-label').catch(() => '')) || ''
            if (label.includes('停止')) {
              await sendButton.click()
              await page.waitForTimeout(2_000)
            }
          }
          const events = (await collectWorkbenchAiRunEvents(runtime)).filter(
            (event) => event.createdAt >= startedAtMs
          )
          const summary = summarizeEvents(events)
          await runtime.captureScreenshot({
            name: 'glm-4-9b-hello-retry',
            message: '免费 GLM-4 9B 发送你好后的过程区。'
          })
          return {
            outcome,
            observeMs: Date.now() - startedAtMs,
            processText: await sampleProcessText(page),
            uiSamples: uiSamples.filter((sample, index) => index % 3 === 0).slice(0, 20),
            ...summary
          }
        },
        assert: async (result, runtime) => {
          runtime.signal({
            name: 'glm-4-9b-hello-retry-timeline',
            message: `9B 你好观察结束 outcome=${result.outcome} brainRounds=${result.brainRounds} retryStarts=${result.retryStarted} restartTo1=${result.retryRestartCount}`,
            data: result
          })
          await runtime.assertThat(result.brainRounds > 0 || result.retryStarted > 0, {
            name: 'workbench-llm-retry-9b-hello-observed',
            message: '免费 GLM-4 9B 发送你好后应至少见到 brain 或自动重试事件。',
            data: result
          })
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
