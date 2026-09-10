import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { buildCompleteTaskDecision } from '../testUtils'

const PARTNER_ID = 'context-scope-fresh-topic-partner'

describe('ai human mock-llm backend', () => {
  it('context-scope-fresh-topic', async () => {
    await runBackendCase({
      caseId: 'context-scope-fresh-topic',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description:
        '上一轮正常交付后发无关新任务时，主模型只收到任务目录和新 user，不含上一轮原文。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const run1 = createHumanTestRunner(runtime, {
          partnerId: PARTNER_ID,
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildCompleteTaskDecision({
                  summary: '已写周报。',
                  deliveryMarkdown: '本周周报已写入，去掉了封面页。SECRET_WEEKLY_REPORT'
                })
              }
            ],
            'human.run_digest': [{ text: '按模板写本周周报，去掉了封面页' }]
          }
        })
        await run1.run({
          taskId: 'context-scope-run-1',
          userInput: '按模板写本周周报，不要封面页。'
        })

        let run2Prompt = ''
        const run2 = createHumanTestRunner(runtime, {
          partnerId: PARTNER_ID,
          humanRuntimeOverrides: { modelContextWindowTokens: 200 },
          structuredOutputScript: {
            'human.context_scope': [
              {
                output: {
                  needsHistory: false
                }
              }
            ],
            'human.brain': [
              (payload) => {
                run2Prompt = payload.user
                return buildCompleteTaskDecision({
                  summary: '已分析销售表。',
                  deliveryMarkdown: '销售表已汇总完成。'
                })
              }
            ],
            'human.run_digest': [{ text: '汇总销售表' }]
          }
        })
        const output = await run2.run({
          taskId: 'context-scope-run-2',
          userInput: '请分析这份销售 Excel 并给出汇总。'
        })
        const log = await runtime.storageService.chatMessageLog.list(PARTNER_ID)
        const scope = [...log]
          .reverse()
          .find(
            (record) =>
              record.entry.kind === 'annotation' &&
              record.entry.eventType === 'context_scope_selected'
          )
        return { output, run2Prompt, scope }
      },
      assert: async (result, runtime) => {
        const payload =
          result.scope?.entry.kind === 'annotation' &&
          result.scope.entry.eventType === 'context_scope_selected'
            ? result.scope.entry.payload
            : undefined
        runtime.assertThat(
          result.output.status === 'completed' &&
            payload?.needsHistory === false &&
            payload.basis === 'model_decision' &&
            typeof payload.discardThroughSeq === 'number' &&
            result.run2Prompt.includes('<task_catalog>') &&
            result.run2Prompt.includes('按模板写本周周报') &&
            !result.run2Prompt.includes('SECRET_WEEKLY_REPORT') &&
            result.run2Prompt.includes('请分析这份销售 Excel'),
          {
            name: 'fresh-topic-drops-unrelated-history-and-keeps-catalog',
            message:
              '无关新任务应判定不需要历史，主模型看到任务目录和新 user，看不到上一轮交付原文。',
            data: {
              status: result.output.status,
              payload,
              promptPreview: result.run2Prompt.slice(0, 2000)
            }
          }
        )
      }
    })
  })

  it('context-scope-incomplete-run', async () => {
    await runBackendCase({
      caseId: 'context-scope-incomplete-run',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '上一轮交付后未写出 run_digest 时，下一轮直接带历史且不调判定模型。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const partnerId = 'context-scope-incomplete-partner'
        await createHumanTestRunner(runtime, {
          partnerId,
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildCompleteTaskDecision({
                  summary: '半截说明。',
                  deliveryMarkdown: '过拟合是模型把训练噪声也记住了。'
                })
              }
            ],
            'human.run_digest': [{ error: 'digest failed' }]
          }
        }).run({
          taskId: 'context-scope-incomplete-run-1',
          userInput: '用一句话解释什么是过拟合。'
        })

        const beforeRun2 = runtime.eventCollector.snapshotLlmIo().length
        const output = await createHumanTestRunner(runtime, {
          partnerId,
          structuredOutputScript: {
            'human.context_scope': [
              {
                output: { needsHistory: false }
              }
            ],
            'human.brain': [
              {
                output: buildCompleteTaskDecision({
                  summary: '已继续。',
                  deliveryMarkdown: '过拟合就是把噪声当规律。'
                })
              }
            ],
            'human.run_digest': [{ text: '继续解释过拟合' }]
          }
        }).run({
          taskId: 'context-scope-incomplete-run-2',
          userInput: '继续刚才的解释。'
        })
        const log = await runtime.storageService.chatMessageLog.list(partnerId)
        const scope = [...log]
          .reverse()
          .find(
            (record) =>
              record.entry.kind === 'annotation' &&
              record.entry.eventType === 'context_scope_selected'
          )
        const run2ScopeCalls = runtime.eventCollector
          .snapshotLlmIo()
          .slice(beforeRun2)
          .filter((record) => record.caller === 'human.context_scope').length
        return { output, scope, run2ScopeCalls }
      },
      assert: async (result, runtime) => {
        const payload =
          result.scope?.entry.kind === 'annotation' &&
          result.scope.entry.eventType === 'context_scope_selected'
            ? result.scope.entry.payload
            : undefined
        runtime.assertThat(
          result.output.status === 'completed' &&
            payload?.needsHistory === true &&
            payload.basis === 'gate_incomplete_run' &&
            result.run2ScopeCalls === 0,
          {
            name: 'incomplete-run-skips-scope-model',
            message: '没有 run_digest 的上一轮之后必须直接带历史，且不得调用判定模型。',
            data: {
              status: result.output.status,
              payload,
              run2ScopeCalls: result.run2ScopeCalls
            }
          }
        )
      }
    })
  })
})
