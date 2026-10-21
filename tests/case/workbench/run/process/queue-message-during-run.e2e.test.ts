import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import type { AiRunEvent } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  collectWorkbenchAiRunEvents,
  getWorkbenchLocator,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setWorkbenchInput,
  setupWorkbenchWithTempWorkspace,
  waitForWorkbenchAiEvent,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'queue-message-during-run'
const FIRST_INPUT =
  '请阅读 handoff-a.txt、handoff-b.txt 和 handoff-c.txt，比较三个项目的负责人及各自下一步，并给我一个简短汇总。'
const FIRST_QUEUED_INPUT = '补充：把需要其他团队配合的事项单独列出来。'
const SECOND_QUEUED_INPUT = '再补充：按项目分别写出负责人和下一步。'

const isTerminalForRun = (event: AiRunEvent, runId: string): boolean =>
  event.runId === runId &&
  (event.type === 'run_completed' || event.type === 'run_failed' || event.type === 'run_cancelled')

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
          '真实模型读取资料过程中追加两条消息，验证单一主按钮切换、浅灰待处理态及安全边界后的 FIFO 续接。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const setup = await setupWorkbenchWithTempWorkspace(runtime.page, { caseId: CASE_ID })
          for (const [name, content] of [
            ['handoff-a.txt', '项目 A：负责人 Alice；下一步完成接口联调；需要法务团队确认条款。'],
            ['handoff-b.txt', '项目 B：负责人 Bob；下一步补齐测试；需要数据团队提供样本。'],
            ['handoff-c.txt', '项目 C：负责人 Carol；下一步提交周报；无需其他团队配合。']
          ]) {
            await fs.writeFile(path.join(setup.workspace.rootPath, name), content, 'utf8')
          }

          const startedAtMs = Date.now()
          await sendWorkbenchMessage(runtime.page, FIRST_INPUT)
          const firstRunStarted = await waitForWorkbenchAiEvent(runtime, {
            name: 'initial-run-started',
            matches: (event) => event.type === 'run_started' && event.input === FIRST_INPUT
          })
          const readStarted = await waitForWorkbenchAiEvent(runtime, {
            name: 'initial-run-file-read-started',
            matches: (event) =>
              event.type === 'tool_call_started' &&
              event.runId === firstRunStarted.runId &&
              event.toolName === 'text_file_read'
          })
          const firstRunDurationTestId = await runtime.page
            .waitForFunction(
              (prefix) =>
                document
                  .querySelector(`[data-testid^="${prefix}-"]`)
                  ?.getAttribute('data-testid') || null,
              workbenchSelectors.assistantRunDurationPrefix,
              { timeout: 10_000 }
            )
            .then(async (handle) => await handle.jsonValue<string>())

          await setWorkbenchInput(runtime.page, FIRST_QUEUED_INPUT)
          await runtime.page.waitForFunction(
            (testId) =>
              document.querySelector(`[data-testid="${testId}"]`)?.getAttribute('aria-label') ===
              '发送',
            workbenchSelectors.sendButton,
            { timeout: 10_000 }
          )
          const sendButtonCountWithDraft = await getWorkbenchLocator(
            runtime.page,
            workbenchSelectors.sendButton
          ).count()
          await getWorkbenchLocator(runtime.page, workbenchSelectors.sendButton).click()
          await runtime.page.waitForFunction(
            (expected) =>
              Array.from(document.querySelectorAll('[data-message-pending="true"]')).some((node) =>
                node.textContent?.includes(expected)
              ),
            FIRST_QUEUED_INPUT,
            { timeout: 10_000 }
          )
          await runtime.page.waitForFunction(
            () => {
              const id = document
                .querySelector('[data-message-pending="true"]')
                ?.getAttribute('data-message-id')
              return Boolean(id && !id.startsWith('local-user-'))
            },
            undefined,
            { timeout: 10_000 }
          )
          await runtime.page.waitForFunction(
            (testId) =>
              document.querySelector(`[data-testid="${testId}"]`)?.getAttribute('aria-label') ===
              '停止本次运行',
            workbenchSelectors.sendButton,
            { timeout: 10_000 }
          )

          await setWorkbenchInput(runtime.page, SECOND_QUEUED_INPUT)
          await runtime.page.waitForFunction(
            (testId) =>
              document.querySelector(`[data-testid="${testId}"]`)?.getAttribute('aria-label') ===
              '发送',
            workbenchSelectors.sendButton,
            { timeout: 10_000 }
          )
          await getWorkbenchLocator(runtime.page, workbenchSelectors.sendButton).click()
          await runtime.page.waitForFunction(
            (expected) =>
              Array.from(document.querySelectorAll('[data-message-pending="true"]')).some((node) =>
                node.textContent?.includes(expected)
              ),
            SECOND_QUEUED_INPUT,
            { timeout: 10_000 }
          )

          const pendingMessages = runtime.page.locator('[data-message-pending="true"]')
          const pendingCount = await pendingMessages.count()
          const pendingTexts = (await pendingMessages.allTextContents()).map((text) => text.trim())
          const firstPendingClass = (await pendingMessages.first().getAttribute('class')) || ''
          const firstPendingMessageId = await pendingMessages
            .first()
            .getAttribute('data-message-id')
          const pendingEditButtonCount = firstPendingMessageId
            ? await getWorkbenchLocator(
                runtime.page,
                `${workbenchSelectors.userMessageEditButtonPrefix}-${firstPendingMessageId}`
              ).count()
            : 0
          const primaryButtonLabel =
            (await getWorkbenchLocator(runtime.page, workbenchSelectors.sendButton).getAttribute(
              'aria-label'
            )) || ''
          const primaryButtonEnabled = await getWorkbenchLocator(
            runtime.page,
            workbenchSelectors.sendButton
          ).isEnabled()
          const primaryButtonCount = await getWorkbenchLocator(
            runtime.page,
            workbenchSelectors.sendButton
          ).count()

          const firstRunTerminal = await waitForWorkbenchAiEvent(runtime, {
            name: 'initial-run-finished',
            matches: (event) => isTerminalForRun(event, firstRunStarted.runId)
          })
          if (firstRunTerminal.type !== 'run_completed') {
            throw new Error(`initial run ended with ${firstRunTerminal.type}`)
          }
          await runtime.page.waitForFunction(
            (testId) =>
              /^用时\s*(?:[1-9]\d*分钟)?\d+秒$/u.test(
                document.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() || ''
              ),
            firstRunDurationTestId,
            { timeout: 10_000 }
          )
          const firstRunDurationText =
            (await runtime.page
              .locator(`[data-testid="${firstRunDurationTestId}"]`)
              .textContent()) || ''
          const firstRunAssistantMessageId = firstRunDurationTestId.slice(
            `${workbenchSelectors.assistantRunDurationPrefix}-`.length
          )
          const firstRunUserBeforeAssistant = await runtime.page.evaluate(
            ({ assistantMessageId, userInput, userMessagePrefix }) => {
              const userMessage = Array.from(
                document.querySelectorAll(`[data-testid^="${userMessagePrefix}-"]`)
              ).find((element) => element.textContent?.includes(userInput))
              const assistantTurn = document.querySelector(
                `[data-testid="workbench-assistant-turn-${assistantMessageId}"]`
              )
              return Boolean(
                userMessage &&
                assistantTurn &&
                userMessage.compareDocumentPosition(assistantTurn) &
                  Node.DOCUMENT_POSITION_FOLLOWING
              )
            },
            {
              assistantMessageId: firstRunAssistantMessageId,
              userInput: FIRST_INPUT,
              userMessagePrefix: workbenchSelectors.userMessagePrefix
            }
          )

          const continuationStarted = await waitForWorkbenchAiEvent(runtime, {
            name: 'queued-continuation-started',
            matches: (event) => event.type === 'run_started' && event.input === SECOND_QUEUED_INPUT
          })
          const continuationTerminal = await waitForWorkbenchAiEvent(runtime, {
            name: 'queued-continuation-finished',
            matches: (event) => isTerminalForRun(event, continuationStarted.runId)
          })
          if (continuationTerminal.type !== 'run_completed') {
            throw new Error(`queued continuation ended with ${continuationTerminal.type}`)
          }

          const events = await collectWorkbenchAiRunEvents(runtime)
          const scopedEvents = events.filter(
            (event) =>
              event.runId === firstRunStarted.runId || event.runId === continuationStarted.runId
          )
          const toolResults = scopedEvents.filter(
            (event): event is Extract<AiRunEvent, { type: 'tool_call_result' }> =>
              event.type === 'tool_call_result'
          )
          const finalAnswerText =
            scopedEvents
              .filter(
                (event): event is Extract<AiRunEvent, { type: 'answer_completed' }> =>
                  event.type === 'answer_completed' && event.runId === continuationStarted.runId
              )
              .at(-1)?.text || ''
          recordWorkbenchAiEvidence(
            runtime,
            {
              modelName: setup.env.modelName,
              durationMs: Date.now() - startedAtMs,
              events: scopedEvents,
              finalAnswerText
            },
            0.85
          )

          return {
            readToolName: readStarted.type === 'tool_call_started' ? readStarted.toolName : '',
            pendingCount,
            pendingTexts,
            firstPendingClass,
            pendingEditButtonCount,
            primaryButtonLabel,
            primaryButtonEnabled,
            primaryButtonCount,
            sendButtonCountWithDraft,
            firstRunId: firstRunStarted.runId,
            continuationInput:
              continuationStarted.type === 'run_started' ? continuationStarted.input : '',
            firstRunDurationText,
            firstRunUserBeforeAssistant,
            firstQueuedInput: FIRST_QUEUED_INPUT,
            secondQueuedInput: SECOND_QUEUED_INPUT,
            toolResults: toolResults.map((event) => ({
              toolName: event.toolName,
              ok: event.result?.ok
            })),
            finalAnswerText
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.readToolName === 'text_file_read' &&
              result.pendingCount === 2 &&
              result.pendingTexts[0]?.includes(FIRST_QUEUED_INPUT) &&
              result.pendingTexts[1]?.includes(SECOND_QUEUED_INPUT) &&
              result.firstPendingClass.includes('opacity-60') &&
              result.pendingEditButtonCount === 0 &&
              result.primaryButtonLabel.includes('停止') &&
              result.primaryButtonEnabled &&
              result.primaryButtonCount === 1 &&
              result.sendButtonCountWithDraft === 1 &&
              result.continuationInput === SECOND_QUEUED_INPUT &&
              /^用时\s*(?:[1-9]\d*分钟)?\d+秒$/u.test(result.firstRunDurationText.trim()) &&
              result.firstRunUserBeforeAssistant &&
              result.toolResults.some((event) => event.toolName === 'text_file_read' && event.ok),
            {
              name: 'workbench-queues-messages-during-ai-run',
              message:
                '运行中只有一个主按钮，空草稿时停止、有草稿时发送并排队；新增消息保持浅灰且无编辑入口，并在当前工具完成后按 FIFO 启动一次续接。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
