import { describe, it } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
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
const INTERRUPTED_TOKEN = 'INTERRUPTED-TASK-77'
const INTERRUPTED_INPUT = `先做 ${INTERRUPTED_TOKEN}，做到一半就停，不要读文件。`
const RUN1_INPUT = `记住关键词 ${TOKEN}，用一句话确认你收到了，不要读文件。`
const RUN2_INPUT = '把刚才那个确认再缩短成十个字。'
const RUN3_INPUT = '法国的首都是哪里？不要提刚才的关键词或机器学习。'
const RUN4_INPUT = '巴黎属于哪个大区？只回答大区名。'
const RUN5_INPUT = `刚才那个 ${TOKEN} 的关键词是什么？`

const lastScopeDecision = async (
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
                reason?: string
                throughSeq?: number
                conversationHistory?: string
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
  const decided = [...log]
    .reverse()
    .find(
      (item) =>
        item.entry.kind === 'annotation' && item.entry.eventType === 'context_scope_decided'
    )
  const discard = [...log]
    .reverse()
    .find(
      (item) =>
        item.entry.kind === 'annotation' && item.entry.eventType === 'discard_checkpoint'
    )
  return {
    decided:
      decided?.entry.kind === 'annotation' && decided.entry.eventType === 'context_scope_decided'
        ? decided.entry.payload
        : undefined,
    discard:
      discard?.entry.kind === 'annotation' && discard.entry.eventType === 'discard_checkpoint'
        ? discard.entry.payload
        : undefined
  }
}

const firstBrain = (records: readonly AiLlmIoRecord[]): AiLlmIoRecord | undefined =>
  records.find((record) => record.caller === 'human.brain')

const humanContents = (record: AiLlmIoRecord | undefined): string[] =>
  (record?.requestWire?.messages || [])
    .filter((message) => message.role === 'human')
    .map((message) => String(message.content || ''))

const messageRoles = (record: AiLlmIoRecord | undefined): string[] =>
  (record?.requestWire?.messages || []).map((message) => message.role)

const discardHuman = (humans: readonly string[]): string | undefined =>
  humans.find((text) => text.includes('以下是最近的会话内容'))

const conversationUserInputs = (history: string | undefined): string[] =>
  String(history || '')
    .split('\n')
    .filter((line) => line.startsWith('用户：'))
    .map((line) => line.slice('用户：'.length))

const conversationBlocks = (history: string | undefined): string[] =>
  String(history || '')
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean)

const hasModelReason = (decided?: { basis?: string; reason?: string }): boolean =>
  decided?.basis !== 'model_decision' || Boolean(decided.reason?.trim())

const scopeJudgeUser = (records: readonly AiLlmIoRecord[]): string => {
  const call = records.find((record) => record.caller === 'human.context_scope')
  return String(call?.user || '')
}

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
          '同一伙伴连续五轮：相关追问保留原文并命中前缀缓存；无关新任务写入 conversationHistory；丢掉后再续做复用同一份 Discard User；再丢一次时判定只看到新话题 digest。Run1 前有一轮无 digest 的中断对话，丢掉时不得配进召回。',
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

          createHumanTestRunner(runtime, {
            partnerId,
            humanRuntimeOverrides: overrides
          })
          await runtime.storageService.chatMessageLog.appendBatch({
            partnerId,
            runId: uuidv4(),
            entries: [
              {
                kind: 'user',
                content: INTERRUPTED_INPUT,
                input: INTERRUPTED_INPUT,
                context: { selectedReferences: [], attachments: [] }
              },
              { kind: 'assistant', content: '做到一半。', toolCalls: [] }
            ]
          })

          const run1 = await run(`${runtime.taskId}-a`, RUN1_INPUT)
          const afterRun1 = runtime.eventCollector.snapshotLlmIo()

          const run2 = await run(`${runtime.taskId}-b`, RUN2_INPUT)
          const afterRun2 = runtime.eventCollector.snapshotLlmIo()
          const run2Io = afterRun2.slice(afterRun1.length)
          const run2Brain = firstBrain(run2Io)
          const run2Humans = humanContents(run2Brain)
          const run2Scope = await lastScopeDecision(runtime, partnerId)

          const run3 = await run(`${runtime.taskId}-c`, RUN3_INPUT)
          const afterRun3 = runtime.eventCollector.snapshotLlmIo()
          const run3Io = afterRun3.slice(afterRun2.length)
          const run3Brain = firstBrain(run3Io)
          const run3Humans = humanContents(run3Brain)
          const run3Scope = await lastScopeDecision(runtime, partnerId)
          const run3DiscardHuman = discardHuman(run3Humans)

          const run4 = await run(`${runtime.taskId}-d`, RUN4_INPUT)
          const afterRun4 = runtime.eventCollector.snapshotLlmIo()
          const run4Io = afterRun4.slice(afterRun3.length)
          const run4Brain = firstBrain(run4Io)
          const run4Humans = humanContents(run4Brain)
          const run4Scope = await lastScopeDecision(runtime, partnerId)
          const run4DiscardHuman = discardHuman(run4Humans)

          const run5 = await run(`${runtime.taskId}-e`, RUN5_INPUT)
          const run5Io = runtime.eventCollector.snapshotLlmIo().slice(afterRun4.length)
          const run5Humans = humanContents(firstBrain(run5Io))
          const run5Scope = await lastScopeDecision(runtime, partnerId)

          return {
            run1,
            run2,
            run3,
            run4,
            run5,
            run2Scope,
            run2Roles: messageRoles(run2Brain),
            run2HasDiscardUser: Boolean(discardHuman(run2Humans)),
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
            run3DiscardHuman,
            run4Scope,
            run4DiscardHuman,
            run4LastIsCurrent: run4Humans.at(-1)?.includes(RUN4_INPUT) === true,
            run4PrefixCache: collectContinuationPrefixCacheReuse({
              previousLlmIo: run3Io,
              nextLlmIo: run4Io
            }),
            run5Scope,
            run5JudgeUser: scopeJudgeUser(run5Io),
            run5HasCatalog: run5Humans.some((text) => text.includes('<task_catalog>')),
            run5HistoryUsers: conversationUserInputs(run5Scope.discard?.conversationHistory),
            run5HistoryBlocks: conversationBlocks(run5Scope.discard?.conversationHistory),
            run3HistoryUsers: conversationUserInputs(run3Scope.discard?.conversationHistory),
            run5Delivery: run5.deliveryMarkdown || ''
          }
        },
        assert: async (result, runtime) => {
          runtime.assertThat(
            result.run1.status === 'completed' &&
              result.run2.status === 'completed' &&
              result.run2Scope.decided?.needsHistory === true &&
              hasModelReason(result.run2Scope.decided) &&
              result.run2HasRun1User &&
              result.run2LastIsCurrent &&
              result.run2HasDiscardUser === false &&
              result.run2Roles[0] === 'system',
            {
              name: 'continuation-keeps-history-without-discard-user',
              message: '相关追问应带上上一轮原文；没丢过历史时不合成 Discard User。',
              data: {
                run1: result.run1.status,
                run2: result.run2.status,
                run2Scope: result.run2Scope,
                run2HasRun1User: result.run2HasRun1User,
                run2LastIsCurrent: result.run2LastIsCurrent,
                run2HasDiscardUser: result.run2HasDiscardUser,
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
              result.run3Scope.decided?.needsHistory === false &&
              Boolean(result.run3Scope.decided.reason?.trim()) &&
              typeof result.run3Scope.discard?.throughSeq === 'number' &&
              typeof result.run3Scope.discard.conversationHistory === 'string' &&
              result.run3HistoryUsers[0] === RUN1_INPUT &&
              result.run3HistoryUsers[1] === RUN2_INPUT &&
              !result.run3HistoryUsers.includes(INTERRUPTED_INPUT) &&
              result.run3Scope.discard.conversationHistory.includes(`用户：${RUN1_INPUT}`) &&
              !result.run3Scope.discard.conversationHistory.includes(INTERRUPTED_TOKEN) &&
              result.run3DiscardHuman?.includes(INTERRUPTED_TOKEN) !== true &&
              result.run3HasCatalog === false &&
              Boolean(result.run3DiscardHuman) &&
              result.run3HasRun1User &&
              result.run3LastIsCurrent,
            {
              name: 'fresh-topic-writes-conversation-history',
              message:
                '无关新任务应丢弃旧原文、写下 conversationHistory；失败轮无 digest 不得配进召回；brain 含 Discard User 与 Run 1 用户原句，不含 task_catalog。',
              data: {
                run3: result.run3.status,
                run3Scope: result.run3Scope,
                run3HasCatalog: result.run3HasCatalog,
                run3HasRun1User: result.run3HasRun1User,
                run3LastIsCurrent: result.run3LastIsCurrent,
                run3HistoryUsers: result.run3HistoryUsers,
                run3DiscardPreview: result.run3DiscardHuman?.slice(0, 500)
              }
            }
          )
          runtime.assertThat(
            result.run4.status === 'completed' &&
              result.run4Scope.decided?.needsHistory === true &&
              hasModelReason(result.run4Scope.decided) &&
              result.run4DiscardHuman === result.run3DiscardHuman &&
              result.run4LastIsCurrent,
            {
              name: 'follow-up-reuses-same-discard-user',
              message: '丢掉后再续做应判定需要历史，且 Discard User 字节与丢掉当轮相同。',
              data: {
                run4: result.run4.status,
                run4Scope: result.run4Scope,
                run4LastIsCurrent: result.run4LastIsCurrent,
                run3DiscardPreview: result.run3DiscardHuman?.slice(0, 300),
                run4DiscardPreview: result.run4DiscardHuman?.slice(0, 300)
              }
            }
          )
          runtime.assertThat(result.run4PrefixCache.satisfied === true, {
            name: 'follow-up-reuses-discard-prefix-cache',
            message: `丢掉后再续做的首次 brain 应复用丢掉当轮前缀缓存（≥ ${CROSS_RUN_PREFIX_CACHE_MIN_RATIO}）。`,
            data: continuationPrefixCacheAssertionData(result.run4PrefixCache)
          })
          runtime.assertThat(
            result.run5.status === 'completed' &&
              result.run5Scope.decided?.needsHistory === false &&
              Boolean(result.run5Scope.decided.reason?.trim()) &&
              typeof result.run5Scope.discard?.conversationHistory === 'string' &&
              result.run5Scope.discard.conversationHistory !==
                result.run3Scope.discard?.conversationHistory &&
              result.run5HistoryUsers[0] === RUN1_INPUT &&
              result.run5HistoryUsers[1] === RUN2_INPUT &&
              result.run5HistoryUsers[2] === RUN3_INPUT &&
              result.run5HistoryUsers[3] === RUN4_INPUT &&
              result.run5HistoryUsers.includes(INTERRUPTED_INPUT) === false &&
              result.run5Scope.discard.conversationHistory.includes(INTERRUPTED_TOKEN) === false &&
              result.run5HistoryBlocks[0]?.includes(`用户：${RUN1_INPUT}`) === true &&
              result.run5HistoryBlocks[0]?.includes(`用户：${RUN4_INPUT}`) !== true &&
              result.run5JudgeUser.includes('法国') &&
              !result.run5JudgeUser.split('<new_task_goal>')[0]?.includes(TOKEN) &&
              result.run5HasCatalog === false &&
              new RegExp(TOKEN, 'i').test(result.run5Delivery),
            {
              name: 'second-discard-recalls-token-from-history',
              message:
                '再问旧关键词时，判定只看到法国 digest；新 conversationHistory 应按轮配对 Run1～4 用户原话，且不含失败轮标记；交付含 TOKEN。',
              data: {
                run5: result.run5.status,
                run5Scope: result.run5Scope,
                run5HasCatalog: result.run5HasCatalog,
                run5HistoryUsers: result.run5HistoryUsers,
                run5HistoryBlocks: result.run5HistoryBlocks,
                run5JudgeUser: result.run5JudgeUser.slice(0, 1000),
                delivery: result.run5Delivery
              }
            }
          )
        }
      })
    })
  })
})
