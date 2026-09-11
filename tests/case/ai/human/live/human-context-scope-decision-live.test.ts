import path from 'node:path'
import { describe, it } from 'vitest'
import { LlmProviderError } from '../../../../../src/main/services/ai/errors'
import { isAiRunFailure } from '../../../../../src/main/services/ai/utils/runFailure'
import type { AiLlmIoRecord, SelectedReference } from '../../../../../src/shared/types'
import { FAILED_RUN_DELIVERY_TEXT } from '../../../../../src/main/services/ai/human/memory/runDigestCatalog'
import { loadLiveLlmConfigFromEnv } from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { SHARED_WORKSPACE_FIXTURE_PATH } from '../../../../harness/backend/aiLiveTestData'
import type { BackendTestRuntime, CreateAiRunContextInput } from '../../../../harness/backend/test-types'
import {
  collectContinuationPrefixCacheReuse,
  continuationPrefixCacheAssertionData
} from '../../../../harness/core/continuation-prefix-cache'
import { runWithStructuredOutputRetry } from '../testUtils'

const WINDOW_TOKENS = 3_500
const TOKEN = 'ALPHA-REPORT-42'
const INTERRUPTED_TOKEN = 'INTERRUPTED-TASK-77'
const PREVIEW_FIXTURE = `${SHARED_WORKSPACE_FIXTURE_PATH}/workbench-preview.md`
const RUN1_INPUT = `请确认你看到了选中资料的文件名，并记住关键词 ${TOKEN}。用一句话确认，不要读文件。`
const RUN2_INPUT = `继续刚才记住的 ${TOKEN}，同时确认 ${INTERRUPTED_TOKEN} 也要保留。用一句话开始，不要读文件。`
const RUN3_INPUT = `刚才那件事中断了。请用一句话确认 ${INTERRUPTED_TOKEN} 还在，不要读文件。`
const RUN4_INPUT = '把刚才那个确认再缩短成十个字。'
const RUN5_INPUT = '法国的首都是哪里？不要提刚才的关键词或机器学习。'
const RUN6_INPUT = '刚才回答的那个首都属于哪个大区？只回答大区名。'
const RUN7_INPUT = `刚才那个 ${TOKEN} 的关键词是什么？`

const lastScopeDecision = async (
  runtime: BackendTestRuntime,
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

const buildPreviewReference = (runtime: BackendTestRuntime): SelectedReference => {
  const absolutePath = runtime.getFixtureWorkspacePath(PREVIEW_FIXTURE)
  return {
    kind: 'file',
    workspaceId: 'test-workspace',
    nodeId: 'preview-md',
    name: path.basename(absolutePath),
    relativePath: path.relative(runtime.workspaceRoot, absolutePath).split(path.sep).join('/'),
    absolutePath,
    fileExt: '.md',
    kbDocumentIds: [],
    kbAvailability: 'not_indexed'
  }
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
          '同一伙伴连续七轮真实发送：带参考完成、真实中断无交付、恢复、相关缩短与前缀缓存、无关 discard 含失败轮固定文案、冻字节续做、再提更早轮。',
        fixtures: [SHARED_WORKSPACE_FIXTURE_PATH],
        runMode: 'single',
        runtimeModelName: loadLiveLlmConfigFromEnv().model_name,
        messageLogAnnotationPartnerIds: (runtime) => [`${runtime.runId}-scope`],
        execute: async (runtime) => {
          const partnerId = `${runtime.runId}-scope`
          const overrides = { modelContextWindowTokens: WINDOW_TOKENS }
          const previewReference = buildPreviewReference(runtime)
          const send = async (
            taskId: string,
            userInput: string,
            extra: Pick<CreateAiRunContextInput, 'selectedReferences' | 'chatToolsWrapper'> = {}
          ) => {
            const created = createHumanTestRunner(runtime, {
              partnerId,
              bindWorkspace: true,
              selectedReferences: extra.selectedReferences,
              chatToolsWrapper: extra.chatToolsWrapper,
              humanRuntimeOverrides: overrides
            })
            try {
              const output = await created.run({ taskId, userInput })
              return { ...output, runId: created.ctx.runId }
            } catch (error) {
              if (!isAiRunFailure(error)) throw error
              return {
                taskId,
                status: 'failed' as const,
                failureCode: error.failureCode,
                deliveryMarkdown: '',
                runId: created.ctx.runId
              }
            }
          }

          const run1 = await send(`${runtime.taskId}-1`, RUN1_INPUT, {
            selectedReferences: [previewReference]
          })

          const run2 = await send(`${runtime.taskId}-2`, RUN2_INPUT, {
            chatToolsWrapper: () => async (request) => {
              if (request.caller === 'human.brain') {
                throw new LlmProviderError({ message: 'fetch failed', retryable: false })
              }
              throw new Error(`unexpected caller ${request.caller}`)
            }
          })

          const run3 = await send(`${runtime.taskId}-3`, RUN3_INPUT)
          const run4 = await send(`${runtime.taskId}-4`, RUN4_INPUT)
          const run4Scope = await lastScopeDecision(runtime, partnerId)
          const run5 = await send(`${runtime.taskId}-5`, RUN5_INPUT)
          const run5Scope = await lastScopeDecision(runtime, partnerId)
          const run6 = await send(`${runtime.taskId}-6`, RUN6_INPUT)
          const run6Scope = await lastScopeDecision(runtime, partnerId)
          const run7 = await send(`${runtime.taskId}-7`, RUN7_INPUT)
          const run7Scope = await lastScopeDecision(runtime, partnerId)
          const run2Records = (await runtime.storageService.chatMessageLog.list(partnerId)).filter(
            (record) => record.runId === run2.runId
          )

          return {
            run1,
            run2,
            run3,
            run4,
            run5,
            run6,
            run7,
            runIds: [
              run1.runId,
              run2.runId,
              run3.runId,
              run4.runId,
              run5.runId,
              run6.runId,
              run7.runId
            ],
            previewName: previewReference.name,
            run4Scope,
            run5Scope,
            run5HistoryUsers: conversationUserInputs(run5Scope.discard?.conversationHistory),
            run5HistoryBlocks: conversationBlocks(run5Scope.discard?.conversationHistory),
            run6Scope,
            run7Scope,
            run7HistoryUsers: conversationUserInputs(run7Scope.discard?.conversationHistory),
            run2HasDelivery: run2Records.some(
              (record) => record.entry.kind === 'assistant' && record.entry.toolCalls.length === 0
            ),
            run2HasDigest: run2Records.some(
              (record) =>
                record.entry.kind === 'annotation' && record.entry.eventType === 'run_digest'
            )
          }
        },
        assert: async (result, runtime) => {
          const allIo = runtime.eventCollector.snapshotLlmIo()
          const ioFor = (taskId: string) =>
            allIo.filter((record) => record.taskId === taskId)
          const run3Io = ioFor(result.run3.taskId)
          const run4Io = ioFor(result.run4.taskId)
          const run5Io = ioFor(result.run5.taskId)
          const run6Io = ioFor(result.run6.taskId)
          const run7Io = ioFor(result.run7.taskId)
          const run4Brain = firstBrain(run4Io)
          const run4Humans = humanContents(run4Brain)
          const run5Humans = humanContents(firstBrain(run5Io))
          const run6Humans = humanContents(firstBrain(run6Io))
          const run7Humans = humanContents(firstBrain(run7Io))
          const run5DiscardHuman = discardHuman(run5Humans)
          const run6DiscardHuman = discardHuman(run6Humans)
          const run4PrefixCache = collectContinuationPrefixCacheReuse({
            previousLlmIo: run3Io,
            nextLlmIo: run4Io
          })
          const run6PrefixCache = collectContinuationPrefixCacheReuse({
            previousLlmIo: run5Io,
            nextLlmIo: run6Io
          })
          const failedBlock = result.run5HistoryBlocks.find(
            (block) =>
              block.includes(INTERRUPTED_TOKEN) && block.includes(`交付：${FAILED_RUN_DELIVERY_TEXT}`)
          )
          const completedBeforeFail = result.run5HistoryBlocks.find((block) =>
            block.includes(RUN1_INPUT)
          )
          runtime.assertThat(
            result.run1.status === 'completed' &&
              result.run2.status === 'failed' &&
              result.run2.failureCode === 'llm_request_failed' &&
              result.run2HasDelivery === false &&
              result.run2HasDigest === false &&
              result.run3.status === 'completed' &&
              result.run4.status === 'completed' &&
              result.run4Scope.decided?.needsHistory === true &&
              hasModelReason(result.run4Scope.decided) &&
              run4Humans.some((text) => text.includes(RUN3_INPUT)) &&
              run4Humans.at(-1)?.includes(RUN4_INPUT) === true &&
              Boolean(discardHuman(run4Humans)) === false &&
              messageRoles(run4Brain)[0] === 'system' &&
              new Set(result.runIds).size === 7,
            {
              name: 'continuation-keeps-history-without-discard-user',
              message: '相关追问应带上上一轮原文；没丢过历史时不合成 Discard User。每次发送使用独立 runId。',
              data: {
                run1: result.run1.status,
                run2: result.run2.status,
                run2Failure: result.run2.failureCode,
                run2HasDelivery: result.run2HasDelivery,
                run2HasDigest: result.run2HasDigest,
                run3: result.run3.status,
                run4: result.run4.status,
                run4Scope: result.run4Scope.decided,
                run4Roles: messageRoles(run4Brain),
                run4HumanCount: run4Humans.length,
                runIds: result.runIds
              }
            }
          )
          runtime.assertThat(run4PrefixCache.satisfied, {
            name: 'related-follow-up-hits-prefix-cache',
            message: '相关缩短请求应命中跨 run 前缀缓存。',
            data: continuationPrefixCacheAssertionData(run4PrefixCache)
          })
          runtime.assertThat(
            result.run5.status === 'completed' &&
              result.run5Scope.decided?.needsHistory === false &&
              hasModelReason(result.run5Scope.decided) &&
              Boolean(run5DiscardHuman) &&
              run5Humans.at(-1)?.includes(RUN5_INPUT) === true &&
              result.run5HistoryUsers[0] === RUN1_INPUT &&
              result.run5HistoryUsers.includes(RUN2_INPUT) &&
              result.run5HistoryUsers.includes(RUN3_INPUT) &&
              result.run5HistoryUsers.includes(RUN4_INPUT) &&
              Boolean(completedBeforeFail?.includes(result.previewName)) &&
              Boolean(failedBlock?.includes(`交付：${FAILED_RUN_DELIVERY_TEXT}`)) &&
              failedBlock?.includes(RUN3_INPUT) !== true &&
              Boolean(run5DiscardHuman?.includes(FAILED_RUN_DELIVERY_TEXT)),
            {
              name: 'fresh-topic-discards-with-failed-run-segment',
              message:
                '无关新题应写入 conversationHistory：失败前完成轮、失败轮固定文案、恢复后轮和相关追问；失败轮不得配下一轮交付。',
              data: {
                run5: result.run5.status,
                decided: result.run5Scope.decided,
                historyUsers: result.run5HistoryUsers,
                failedBlock,
                completedBeforeFail
              }
            }
          )
          runtime.assertThat(
            result.run6.status === 'completed' &&
              result.run6Scope.decided?.needsHistory === true &&
              hasModelReason(result.run6Scope.decided) &&
              run6DiscardHuman === run5DiscardHuman &&
              run6Humans.at(-1)?.includes(RUN6_INPUT) === true &&
              run6PrefixCache.satisfied,
            {
              name: 'include-discard-reuses-frozen-bytes',
              message: '丢掉后的相关追问应只读同一份冻结 Discard User 并命中前缀缓存。',
              data: {
                run6: result.run6.status,
                decided: result.run6Scope.decided,
                prefix: continuationPrefixCacheAssertionData(run6PrefixCache)
              }
            }
          )
          runtime.assertThat(
            result.run7.status === 'completed' &&
              result.run7Scope.decided?.needsHistory === false &&
              hasModelReason(result.run7Scope.decided) &&
              !(scopeJudgeUser(run7Io).split('新诉求：')[0] || '').includes(TOKEN) &&
              scopeJudgeUser(run7Io).includes('近期任务：') &&
              result.run7HistoryUsers.includes(RUN2_INPUT) &&
              result.run7HistoryUsers.includes(RUN3_INPUT) &&
              result.run7HistoryUsers.includes(RUN4_INPUT) &&
              result.run7HistoryUsers.includes(RUN5_INPUT) &&
              result.run7HistoryUsers.includes(RUN6_INPUT) &&
              run7Humans.some((text) => text.includes('<task_catalog>')) === false,
            {
              name: 'second-discard-judges-above-floor-and-recalls-earlier-run',
              message: '再提更早轮时判定只看 floor 以上近期任务；再次 discard 后完整召回仍含更早完成轮。',
              data: {
                run7: result.run7.status,
                decided: result.run7Scope.decided,
                judgeUser: scopeJudgeUser(run7Io).slice(0, 2000),
                historyUsers: result.run7HistoryUsers
              }
            }
          )
        }
      })
    })
  })
})
