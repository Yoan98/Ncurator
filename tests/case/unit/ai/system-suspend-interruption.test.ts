import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SystemSuspendMonitor,
  SYSTEM_SUSPEND_INTERRUPT_THRESHOLD_MS,
  systemSuspendMonitor
} from '../../../../src/main/services/app/systemSuspend'
import {
  isSystemSuspendInterruption,
  SystemSuspendInterruption
} from '../../../../src/main/services/ai/errors'
import { createAiLlmExecutor, type AiLlmDriver } from '../../../../src/main/services/ai/llmExecutor'
import { classifyThrownErrorToAiRunFailure } from '../../../../src/main/services/ai/utils/runFailure'
import type { AiRunEvent, LlmRuntimeConfig } from '../../../../src/shared/types'

const config: LlmRuntimeConfig = {
  id: 'cfg-1',
  name: 'Unit Config',
  providerKind: 'openai-compatible',
  base_url: 'https://example.test/v1',
  model_name: 'gpt-5',
  api_key: 'test-key'
}

const createExecutor = (driver: AiLlmDriver, events: AiRunEvent[]) =>
  createAiLlmExecutor({
    eventCtx: { runId: 'suspend-run', sendEvent: (event) => events.push(event) },
    getConfig: async () => config,
    saveConfig: async () => undefined,
    checkCancelled: () => undefined,
    driver
  })

afterEach(() => {
  vi.useRealTimers()
})

describe('system suspend interruption', () => {
  it('reports suspend and resume gaps without double counting', () => {
    const monitor = new SystemSuspendMonitor()
    const suspend = vi.fn()
    const resume = vi.fn()
    const unsubscribeSuspend = monitor.onSuspend(suspend)
    const unsubscribeResume = monitor.onResume(resume)

    monitor.markSuspend(1_000)
    monitor.markSuspend(2_000)
    expect(monitor.suspended).toBe(true)
    expect(suspend).toHaveBeenCalledTimes(1)

    monitor.markResume(842_000)
    expect(monitor.suspended).toBe(false)
    expect(resume).toHaveBeenCalledTimes(1)
    expect(resume).toHaveBeenCalledWith(841_000)

    monitor.markResume(1_000_000)
    expect(resume).toHaveBeenCalledTimes(1)

    unsubscribeSuspend()
    unsubscribeResume()
    monitor.markSuspend(2_000_000)
    monitor.markResume(2_001_000)
    expect(suspend).toHaveBeenCalledTimes(1)
    expect(resume).toHaveBeenCalledTimes(1)
  })

  it('interrupts an active model call after a system suspend and never retries', async () => {
    const events: AiRunEvent[] = []
    const started = Promise.withResolvers<void>()
    let calls = 0
    const driver: AiLlmDriver = {
      chatText: () => {
        calls += 1
        started.resolve()
        return new Promise<never>(() => undefined)
      }
    }
    const executor = createExecutor(driver, events)

    const pending = executor
      .chatText({ caller: 'test', schemaName: 'text', system: 'system', user: 'user' })
      .then(() => undefined, (error) => error)
    await started.promise

    systemSuspendMonitor.markSuspend(1_000)
    systemSuspendMonitor.markResume(842_000)

    const error = await pending
    expect(isSystemSuspendInterruption(error)).toBe(true)
    expect((error as SystemSuspendInterruption).gapMs).toBe(841_000)
    expect(calls).toBe(1)
    expect(
      events.some(
        (event) => event.type === 'assistant_process_group_started' && event.kind === 'retry'
      )
    ).toBe(false)
  })

  it('treats a timer that fires far after its deadline as a system pause', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const events: AiRunEvent[] = []
    const started = Promise.withResolvers<void>()
    let calls = 0
    const driver: AiLlmDriver = {
      chatText: () => {
        calls += 1
        started.resolve()
        return new Promise<never>(() => undefined)
      }
    }
    const executor = createExecutor(driver, events)

    const pending = executor
      .chatText({ caller: 'test', schemaName: 'text', system: 'system', user: 'user' })
      .then(() => undefined, (error) => error)
    await started.promise

    // Move the wall clock past the timer's deadline without advancing the timer
    // itself, which is what a suspended process looks like on resume.
    vi.setSystemTime(14 * 60 * 1000)
    await vi.runOnlyPendingTimersAsync()

    const error = await pending
    expect(isSystemSuspendInterruption(error)).toBe(true)
    expect((error as SystemSuspendInterruption).gapMs).toBe(14 * 60 * 1000)
    expect((error as SystemSuspendInterruption).gapMs).toBeGreaterThanOrEqual(
      SYSTEM_SUSPEND_INTERRUPT_THRESHOLD_MS
    )
    expect(calls).toBe(1)
    expect(
      events.some(
        (event) => event.type === 'assistant_process_group_started' && event.kind === 'retry'
      )
    ).toBe(false)
  })

  it('maps a system suspend to process_interrupted with an accurate message', () => {
    const failure = classifyThrownErrorToAiRunFailure(new SystemSuspendInterruption(841_000))
    expect(failure.failureCode).toBe('process_interrupted')
    expect(failure.message).toBe('任务已中断，可继续对话推进')
    expect(failure.rawMessage).toBe(
      '电脑休眠 14 分 01 秒，模型连接中断。本次回答未完成，可继续对话推进。'
    )
  })
})
