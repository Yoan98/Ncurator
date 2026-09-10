import { describe, it } from 'vitest'
import type { AiLlmIoRecord } from '../../../../../src/shared/types'
import { loadLiveLlmConfigFromEnv } from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  collectContinuationPrefixCacheReuse,
  continuationPrefixCacheAssertionData,
  CROSS_RUN_PREFIX_CACHE_MIN_RATIO
} from '../../../../harness/core/continuation-prefix-cache'
import { runWithStructuredOutputRetry } from '../testUtils'

const WINDOW_TOKENS = 2_000
const TOKEN = 'ALPHA-REPORT-42'
const RUN1_INPUT = `记住关键词 ${TOKEN}，用一句话确认你收到了，不要读文件。`
const RUN2_INPUT = '把刚才那个确认再缩短成十个字。'
const RUN3_INPUT = '法国的首都是哪里？不要提刚才的关键词或机器学习。'
const RUN4_INPUT = `刚才那个 ${TOKEN} 的关键词是什么？如果目录里有就直接说。`

const lastScopePayload = async (
  runtime: {
    storageService: {
      chatMessageLog: {
        list: (id: string) => Promise<
          Array<{
            entry: {
              kind: string
              eventType?: string
              payload?: {
                needsHistory?: boolean
                basis?: string
                discardThroughSeq?: number
              }
            }
          }>
        >
      }
    }
  },
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

const firstBrain = (records: readonly AiLlmIoRecord[]): AiLlmIoRecord | undefined =>
  records.find((record) => record.caller === 'human.brain')

const humanContents = (record: AiLlmIoRecord | undefined): string[] =>
  (record?.requestWire?.messages || [])
    .filter((message) => message.role === 'human')
    .map((message) => String(message.content || ''))

const messageRoles = (record: AiLlmIoRecord | undefined): string[] =>
  (record?.requestWire?.messages || []).map((message) => message.role)

describe('ai human live backend', () => {
  it('human-context-scope-decision-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-context-scope-decision-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description:
          '同一伙伴连续四轮：相关追问保留原文且命中前缀缓存；无关新任务只带目录；再问旧关键词能从目录找回。',
        fixtures: [],
        runMode: 'single',
        runtimeModelName: loadLiveLlmConfigFromEnv().model_name,
        execute: async (runtime) => {
          const partnerId = `${runtime.runId}-scope`
          const overrides = { modelContextWindowTokens: WINDOW_TOKENS }
          const run = (taskId: string, userInput: string) =>
            createHumanTestRunner(runtime, {
              partnerId,
              humanRuntimeOverrides: overrides
            }).run({ taskId, userInput })

          const run1 = await run(`${runtime.taskId}-a`, RUN1_INPUT)
          const afterRun1 = runtime.eventCollector.snapshotLlmIo()

          const run2 = await run(`${runtime.taskId}-b`, RUN2_INPUT)
          const afterRun2 = runtime.eventCollector.snapshotLlmIo()
          const run2Io = afterRun2.slice(afterRun1.length)
          const run2Brain = firstBrain(run2Io)
          const run2Humans = humanContents(run2Brain)
          const run2Scope = await lastScopePayload(runtime, partnerId)

          const run3 = await run(`${runtime.taskId}-c`, RUN3_INPUT)
          const afterRun3 = runtime.eventCollector.snapshotLlmIo()
          const run3Io = afterRun3.slice(afterRun2.length)
          const run3Brain = firstBrain(run3Io)
          const run3Humans = humanContents(run3Brain)
          const run3Scope = await lastScopePayload(runtime, partnerId)

          const run4 = await run(`${runtime.taskId}-d`, RUN4_INPUT)
          const run4Humans = humanContents(
            firstBrain(runtime.eventCollector.snapshotLlmIo().slice(afterRun3.length))
          )
          const run4Scope = await lastScopePayload(runtime, partnerId)

          return {
            run1,
            run2,
            run3,
            run4,
            run2Scope,
            run2Roles: messageRoles(run2Brain),
            run2HasCatalog: run2Humans.some((text) => text.includes('<task_catalog>')),
            run2HasRun1User: run2Humans.some((text) => text.includes(RUN1_INPUT)),
            run2LastIsCurrent: run2Humans.at(-1)?.includes(RUN2_INPUT) === true,
            run2PrefixCache: collectContinuationPrefixCacheReuse({
              previousLlmIo: afterRun1,
              nextLlmIo: run2Io
            }),
            run3Scope,
            run3HasCatalog: run3Humans.some((text) => text.includes('<task_catalog>')),
            run3HasRun1User: run3Humans.some((text) => text.includes(RUN1_INPUT)),
            run3LastIsCurrent: run3Humans.at(-1)?.includes(RUN3_INPUT) === true,
            run4Scope,
            run4HasCatalog: run4Humans.some((text) => text.includes('<task_catalog>')),
            run4Delivery: run4.deliveryMarkdown || ''
          }
        },
        assert: async (result, runtime) => {
          runtime.assertThat(
            result.run1.status === 'completed' &&
              result.run2.status === 'completed' &&
              result.run2Scope?.needsHistory === true &&
              result.run2HasRun1User &&
              result.run2LastIsCurrent &&
              result.run2HasCatalog === false &&
              result.run2Roles[0] === 'system',
            {
              name: 'continuation-keeps-history-without-catalog',
              message: '相关追问应带上上一轮原文、末尾为新 user，且不注入任务目录。',
              data: {
                run1: result.run1.status,
                run2: result.run2.status,
                run2Scope: result.run2Scope,
                run2HasRun1User: result.run2HasRun1User,
                run2LastIsCurrent: result.run2LastIsCurrent,
                run2HasCatalog: result.run2HasCatalog,
                run2Roles: result.run2Roles
              }
            }
          )
          runtime.assertThat(result.run2PrefixCache.satisfied === true, {
            name: 'continuation-reuses-prefix-cache',
            message: `相关追问的首次 brain 应复用上一轮前缀缓存（≥ ${CROSS_RUN_PREFIX_CACHE_MIN_RATIO}）。`,
            data: continuationPrefixCacheAssertionData(result.run2PrefixCache)
          })
          runtime.assertThat(
            result.run3.status === 'completed' &&
              result.run3Scope?.needsHistory === false &&
              typeof result.run3Scope.discardThroughSeq === 'number' &&
              result.run3HasCatalog &&
              result.run3LastIsCurrent &&
              result.run3HasRun1User === false,
            {
              name: 'fresh-topic-omits-unrelated-history',
              message: '无关新任务应丢弃旧原文、注入任务目录，并写下 discard 书签。',
              data: {
                run3: result.run3.status,
                run3Scope: result.run3Scope,
                run3HasCatalog: result.run3HasCatalog,
                run3HasRun1User: result.run3HasRun1User,
                run3LastIsCurrent: result.run3LastIsCurrent
              }
            }
          )
          runtime.assertThat(
            result.run4.status === 'completed' &&
              result.run4Scope?.needsHistory === false &&
              result.run4HasCatalog &&
              new RegExp(TOKEN, 'i').test(result.run4Delivery),
            {
              name: 'catalog-recalls-old-task-token',
              message: '提到已完成旧任务时应判定不需要历史，从目录拿到线索，交付含原关键词。',
              data: {
                run4: result.run4.status,
                run4Scope: result.run4Scope,
                run4HasCatalog: result.run4HasCatalog,
                delivery: result.run4Delivery
              }
            }
          )
        }
      })
    })
  })
})
