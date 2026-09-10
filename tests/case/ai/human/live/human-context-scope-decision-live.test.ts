import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv } from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { runWithStructuredOutputRetry } from '../testUtils'

const WINDOW_TOKENS = 2_000

const lastScopePayload = async (
  runtime: { storageService: { chatMessageLog: { list: (id: string) => Promise<Array<{ entry: { kind: string; eventType?: string; payload?: { needsHistory?: boolean; basis?: string } } }> }> } },
  partnerId: string
) => {
  const log = await runtime.storageService.chatMessageLog.list(partnerId)
  const record = [...log]
    .reverse()
    .find(
      (item) =>
        item.entry.kind === 'annotation' && item.entry.eventType === 'context_scope_selected'
    )
  return record?.entry.kind === 'annotation' && record.entry.eventType === 'context_scope_selected'
    ? record.entry.payload
    : undefined
}

describe('ai human live backend', () => {
  it('human-context-scope-fresh-topic-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-context-scope-fresh-topic-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description:
          '任务 A 交付后发无关任务 B：判定不需要历史，B 首轮不含 A 原文且含任务目录。',
        fixtures: [],
        runMode: 'single',
        runtimeModelName: loadLiveLlmConfigFromEnv().model_name,
        execute: async (runtime) => {
          const partnerId = `${runtime.runId}-fresh`
          await createHumanTestRunner(runtime, {
            partnerId,
            humanRuntimeOverrides: { modelContextWindowTokens: WINDOW_TOKENS }
          }).run({
            taskId: `${runtime.taskId}-a`,
            userInput: '用一句话解释什么是过拟合，不要读文件。'
          })
          const beforeB = runtime.eventCollector.snapshotLlmIo().length
          const output = await createHumanTestRunner(runtime, {
            partnerId,
            humanRuntimeOverrides: { modelContextWindowTokens: WINDOW_TOKENS }
          }).run({
            taskId: `${runtime.taskId}-b`,
            userInput: '法国的首都是哪里？不要提刚才的机器学习问题。'
          })
          const run2Brain = runtime.eventCollector
            .snapshotLlmIo()
            .slice(beforeB)
            .find((record) => record.caller === 'human.brain')
          return {
            output,
            scope: await lastScopePayload(runtime, partnerId),
            run2BrainUser: run2Brain?.user || ''
          }
        },
        assert: async (result, runtime) => {
          runtime.assertThat(
            result.output.status === 'completed' &&
              result.scope?.needsHistory === false &&
              result.run2BrainUser.includes('<task_catalog>') &&
              !result.run2BrainUser.includes('过拟合'),
            {
              name: 'fresh-topic-omits-unrelated-history',
              message: '无关新任务不应把上一轮原文带进主模型，但应带任务目录。',
              data: result
            }
          )
        }
      })
    })
  })

  it('human-context-scope-continuation-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-context-scope-continuation-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '任务 A 交付后发相关追问：判定需要历史，且不含任务目录。',
        fixtures: [],
        runMode: 'single',
        runtimeModelName: loadLiveLlmConfigFromEnv().model_name,
        execute: async (runtime) => {
          const partnerId = `${runtime.runId}-cont`
          await createHumanTestRunner(runtime, {
            partnerId,
            humanRuntimeOverrides: { modelContextWindowTokens: WINDOW_TOKENS }
          }).run({
            taskId: `${runtime.taskId}-a`,
            userInput: '用一句话解释什么是过拟合，不要读文件。'
          })
          const beforeB = runtime.eventCollector.snapshotLlmIo().length
          const output = await createHumanTestRunner(runtime, {
            partnerId,
            humanRuntimeOverrides: { modelContextWindowTokens: WINDOW_TOKENS }
          }).run({
            taskId: `${runtime.taskId}-b`,
            userInput: '把刚才那个解释再缩短成十个字。'
          })
          const run2Brain = runtime.eventCollector
            .snapshotLlmIo()
            .slice(beforeB)
            .find((record) => record.caller === 'human.brain')
          return {
            output,
            scope: await lastScopePayload(runtime, partnerId),
            run2BrainUser: run2Brain?.user || ''
          }
        },
        assert: async (result, runtime) => {
          runtime.assertThat(
            result.output.status === 'completed' &&
              result.scope?.needsHistory === true &&
              !result.run2BrainUser.includes('<task_catalog>'),
            {
              name: 'continuation-keeps-history-without-catalog',
              message: '相关追问应带上历史原文，且不注入任务目录。',
              data: result
            }
          )
        }
      })
    })
  })

  it('human-context-scope-incomplete-run-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-context-scope-incomplete-run-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '上一轮中断后发消息：走 gate_incomplete_run，不调判定模型。',
        fixtures: [],
        runMode: 'single',
        runtimeModelName: loadLiveLlmConfigFromEnv().model_name,
        execute: async (runtime) => {
          const partnerId = `${runtime.runId}-incomplete`
          let checks = 0
          try {
            await createHumanTestRunner(runtime, {
              partnerId,
              humanRuntimeOverrides: { modelContextWindowTokens: WINDOW_TOKENS },
              checkCancelledOverride: () => {
                checks += 1
                if (checks > 6) throw new Error('test_interrupt_before_finish')
              }
            }).run({
              taskId: `${runtime.taskId}-a`,
              userInput: '用一句话解释什么是过拟合。'
            })
          } catch {
            // 预期在写过 user 之后、交付 digest 之前中断
          }
          const beforeB = runtime.eventCollector.snapshotLlmIo().length
          const output = await createHumanTestRunner(runtime, {
            partnerId,
            humanRuntimeOverrides: { modelContextWindowTokens: WINDOW_TOKENS }
          }).run({
            taskId: `${runtime.taskId}-b`,
            userInput: '继续刚才的解释。'
          })
          const run2ScopeCalls = runtime.eventCollector
            .snapshotLlmIo()
            .slice(beforeB)
            .filter((record) => record.caller === 'human.context_scope')
          return {
            output,
            scope: await lastScopePayload(runtime, partnerId),
            run2ScopeCalls: run2ScopeCalls.length
          }
        },
        assert: async (result, runtime) => {
          runtime.assertThat(
            result.output.status === 'completed' &&
              result.scope?.basis === 'gate_incomplete_run' &&
              result.scope.needsHistory === true &&
              result.run2ScopeCalls === 0,
            {
              name: 'incomplete-run-skips-scope-model',
              message: '中断后的续发必须直接带历史，且不得调用判定模型。',
              data: result
            }
          )
        }
      })
    })
  })

  it('human-context-scope-old-task-via-catalog-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-context-scope-old-task-via-catalog-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description:
          'A/B/C 依次交付后提到 A：从目录取到 A 的线索并回答，而不是声称不记得。',
        fixtures: [],
        runMode: 'single',
        runtimeModelName: loadLiveLlmConfigFromEnv().model_name,
        execute: async (runtime) => {
          const partnerId = `${runtime.runId}-catalog`
          const overrides = { modelContextWindowTokens: WINDOW_TOKENS }
          await createHumanTestRunner(runtime, { partnerId, humanRuntimeOverrides: overrides }).run({
            taskId: `${runtime.taskId}-a`,
            userInput: '记住关键词 ALPHA-REPORT-42，用一句话确认你收到了。'
          })
          await createHumanTestRunner(runtime, { partnerId, humanRuntimeOverrides: overrides }).run({
            taskId: `${runtime.taskId}-b`,
            userInput: '法国的首都是哪里？'
          })
          await createHumanTestRunner(runtime, { partnerId, humanRuntimeOverrides: overrides }).run({
            taskId: `${runtime.taskId}-c`,
            userInput: '1+1 等于几？'
          })
          const output = await createHumanTestRunner(runtime, {
            partnerId,
            humanRuntimeOverrides: overrides
          }).run({
            taskId: `${runtime.taskId}-d`,
            userInput: '刚才那个 ALPHA-REPORT-42 的关键词是什么？如果目录里有就直接说。'
          })
          return { output }
        },
        assert: async (result, runtime) => {
          runtime.assertThat(
            result.output.status === 'completed' &&
              /ALPHA-REPORT-42/i.test(result.output.deliveryMarkdown),
            {
              name: 'catalog-recalls-old-task-token',
              message: '提到旧任务时应能从目录拿到线索，而不是声称不记得。',
              data: result
            }
          )
        }
      })
    })
  })
})
