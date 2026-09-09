import { describe, it } from 'vitest'
import type { BaseMessage } from '@langchain/core/messages'
import { AiRunService } from '../../../../../src/main/services/ai/AiRunService'
import type { AiRunDeps } from '../../../../../src/main/services/ai/types'
import { AiFileChangeService } from '../../../../../src/main/services/ai/fileChanges/AiFileChangeService'
import type { AiRunEvent } from '../../../../../src/shared/types'
import { loadLiveLlmConfigFromEnv } from '../../../../harness/backend/llmConfig'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { BackendTestRuntime } from '../../../../harness/backend/test-types'
import {
  buildSelectedDocxFixtureReferences,
  DOCX_READING_FIXTURE_PATHS,
  SHARED_WORKSPACE_FIXTURE_PATH
} from '../../../../harness/backend/aiLiveTestData'
import {
  collectContinuationPrefixCacheReuse,
  continuationPrefixCacheAssertionData,
  type ContinuationPrefixCacheReuse
} from '../../../../harness/core/continuation-prefix-cache'
import { runWithStructuredOutputRetry } from '../testUtils'

const PARTNER_ID = 'live-partner-continuation'
const RUN1_INPUT =
  '我想做一个复习对比小结。请先只看深度学习课件，整理“过拟合/过度拟合”的概念定义、出现原因、处理方式；资料没写某一项就标成未写。'
const RUN2_INPUT =
  '这次我新选了图形学课件。请保留刚才已经整理到的过拟合信息，再补充这份资料里的反走样信息，最后输出一个对比小结。资料没写的地方要直接说明未写。'

const eventText = (event: AiRunEvent): string => JSON.stringify(event)

const runUsedSelectedFile = (
  events: readonly AiRunEvent[],
  runId: string,
  fileName: string
): boolean =>
  events.some(
    (event) =>
      event.runId === runId &&
      ['tool_call_started', 'tool_call_result'].includes(event.type) &&
      ['docx_search', 'docx_read_nodes'].includes(String(event.toolName || '')) &&
      eventText(event).includes(fileName)
  )

const normalizeText = (text: string): string => text.normalize('NFKC')

const mentionsOverfittingTopic = (text: string): boolean =>
  /(过拟合|过度拟合|overfitting)/i.test(normalizeText(text))

const mentionsAntiAliasingTopic = (text: string): boolean =>
  /(反走样|抗锯齿|anti-?aliasing)/i.test(normalizeText(text))

const buildAiRunDeps = async (input: {
  runtime: BackendTestRuntime
  chatToolsWrapper?: AiRunDeps['chatToolsWrapper']
}): Promise<AiRunDeps> => {
  const controller = new AbortController()
  const runtimeSettings = await input.runtime.storageService.aiRuntimeSettings.get()
  const aiFileChangeService = new AiFileChangeService(input.runtime.storageService.aiFileChange)
  return {
    runtimeSettings,
    llmStore: input.runtime.llmStore,
    chatStore: input.runtime.chatStore,
    documentsStore: input.runtime.documentsStore,
    embeddingService: input.runtime.embeddingService,
    ensureEmbeddingReady: async () => {
      await input.runtime.ensureEmbeddingReady()
    },
    docxApplyService: input.runtime.docxApplyService,
    saveFileChangeRecord: async (record) => {
      await aiFileChangeService.saveRecord(record, input.runtime.workspaceRoot)
    },
    listFileChangeRecords: async (request) =>
      (await aiFileChangeService.listRecords(request)).items,
    beginTerminalCommandTracking: async (tracking) => {
      await aiFileChangeService.beginTerminalCommandTracking(tracking)
    },
    finishTerminalCommandTracking: async (commandId) =>
      await aiFileChangeService.finishTerminalCommandTracking(commandId),
    discardTerminalCommandTracking: (commandId) => {
      aiFileChangeService.discardTerminalCommandTracking(commandId)
    },
    chatMessageLogStore: input.runtime.storageService.chatMessageLog,
    isCancelled: () => controller.signal.aborted,
    abortSignal: controller.signal,
    sendEvent: (event) => input.runtime.eventCollector.add(event),
    recordLlmIo: (record) => input.runtime.eventCollector.addLlmIo(record),
    requestApprovalBatch: async () => ({ accepted: true, decisions: [] as never[] }),
    chatToolsWrapper: input.chatToolsWrapper
  }
}

describe('ai human live backend', () => {
  it('human-partner-continuation-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-partner-continuation-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description:
          '验证 live 模式下同一伙伴先完成第一件事，再续接关联的第二件事，消息数组按「历史 + 尾部 user 消息」叠加，且 Run2 首轮 brain 明显复用 Run1 末次前缀缓存。',
        fixtures: [SHARED_WORKSPACE_FIXTURE_PATH],
        runMode: 'single',
        runtimeModelName: loadLiveLlmConfigFromEnv().model_name,
        execute: async (runtime) => {
          if (!loadLiveLlmConfigFromEnv()) {
            return {
              configurationMissing: true,
              run1Result: null,
              run2Result: null,
              run2LastMessageIsUser: false,
              run2LastUserHasNoMemoryOrActiveState: false,
              run2HistoryHasRun1User: false,
              run2HistoryHasRun1Delivery: false,
              run2Delivery: '',
              run2PrefixCache: null as ContinuationPrefixCacheReuse | null,
              fileAName: '',
              fileBName: ''
            }
          }

          const liveConfig = loadLiveLlmConfigFromEnv()
          const fileAReferences = buildSelectedDocxFixtureReferences(runtime, [
            DOCX_READING_FIXTURE_PATHS[0]
          ])
          const fileBReferences = buildSelectedDocxFixtureReferences(runtime, [
            DOCX_READING_FIXTURE_PATHS[1]
          ])

          await runtime.seedLlmConfig(liveConfig)
          await runtime.chatStore.savePartner({
          id: PARTNER_ID,
          name: 'live partner continuation test',
          avatar_shape: 'circle',
          avatar_color: 'blue',
          created_at: Date.now(),
          updated_at: Date.now(),
          last_viewed_at: Date.now(),
          pinned: false,
          pinned_at: null
        })

          const run1Result = await AiRunService.getInstance().run(
            {
              runId: `${runtime.runId}-run-1`,
              partnerId: PARTNER_ID,
              input: RUN1_INPUT,
              selectedReferences: fileAReferences,
              mainModel: { configId: liveConfig.id, modelName: liveConfig.model_name },
              partnerName: '测试伙伴',
              workspaceRoots: [runtime.workspaceRoot]
            },
            await buildAiRunDeps({ runtime })
          )
          const run1LlmIo = runtime.eventCollector.snapshotLlmIo()

          let run2BrainMessages: BaseMessage[] | null = null
          const captureRun2Wrapper: NonNullable<AiRunDeps['chatToolsWrapper']> =
            (realChatTools) => async (request) => {
              if (request.caller === 'human.brain' && !run2BrainMessages) {
                run2BrainMessages = [...request.messages]
              }
              return await realChatTools(request)
            }
          const run2Result = await AiRunService.getInstance().run(
            {
              runId: `${runtime.runId}-run-2`,
              partnerId: PARTNER_ID,
              input: RUN2_INPUT,
              selectedReferences: fileBReferences,
              mainModel: { configId: liveConfig.id, modelName: liveConfig.model_name },
              partnerName: '测试伙伴',
              workspaceRoots: [runtime.workspaceRoot]
            },
            await buildAiRunDeps({ runtime, chatToolsWrapper: captureRun2Wrapper })
          )

          const run2Id = `${runtime.runId}-run-2`
          const run2Events = runtime.eventCollector.snapshot()
          const run2LlmIo = runtime.eventCollector.snapshotLlmIo().slice(run1LlmIo.length)
          const run2LastMessage = run2BrainMessages
            ? run2BrainMessages[run2BrainMessages.length - 1]
            : null
          const run2LastMessageIsUser =
            run2LastMessage?.getType() === 'human' &&
            typeof run2LastMessage.content === 'string' &&
            run2LastMessage.content.includes('<task_goal>') &&
            run2LastMessage.content.includes(RUN2_INPUT)
          const run2LastUserHasNoMemoryOrActiveState =
            typeof run2LastMessage?.content === 'string' &&
            !run2LastMessage.content.includes('<memory>') &&
            !run2LastMessage.content.includes('<active_state>')
          const historyMessages = (run2BrainMessages || []).slice(0, -1)
          const run2HistoryHasRun1User = historyMessages.some(
            (message) =>
              message.getType() === 'human' &&
              typeof message.content === 'string' &&
              message.content.includes('<task_goal>') &&
              message.content.includes(RUN1_INPUT)
          )
          const run2HistoryHasRun1Delivery = historyMessages.some(
            (message) =>
              message.getType() === 'ai' &&
              typeof message.content === 'string' &&
              mentionsOverfittingTopic(message.content)
          )

          return {
            configurationMissing: false,
            run1Result,
            run2Result,
            run2LastMessageIsUser,
            run2LastUserHasNoMemoryOrActiveState,
            run2HistoryHasRun1User,
            run2HistoryHasRun1Delivery,
            run2UsedFileB: runUsedSelectedFile(run2Events, run2Id, fileBReferences[0]?.name || ''),
            run2Delivery: run2Result.finalDeliveryMarkdown || '',
            run2PrefixCache: collectContinuationPrefixCacheReuse({
              previousLlmIo: run1LlmIo,
              nextLlmIo: run2LlmIo
            }),
            fileAName: fileAReferences[0]?.name || '',
            fileBName: fileBReferences[0]?.name || ''
          }
        },
        assert: async (result, runtime) => {
          if (result.configurationMissing) {
            runtime.assertThat(false, {
              name: 'live-config-not-provided',
              message: '未提供 live 模型配置，已跳过 human partner continuation live case。'
            })
            return
          }

          runtime.assertThat(
            result.run1Result?.status === 'completed' &&
              result.run2Result?.status === 'completed' &&
              result.run2LastMessageIsUser &&
              result.run2LastUserHasNoMemoryOrActiveState &&
              result.run2HistoryHasRun1User &&
              result.run2HistoryHasRun1Delivery &&
              result.run2UsedFileB === true &&
              mentionsOverfittingTopic(result.run2Delivery) &&
              mentionsAntiAliasingTopic(result.run2Delivery),
            {
              name: 'human-live-partner-continuation-stacks-message-array',
              message:
                '同伙伴第二件事应在完整历史（含第一件事的 build user 与最终交付）之后尾部追加当前 build user，并完成双主题对比交付。',
              data: {
                run1Status: result.run1Result?.status,
                run1Error: result.run1Result?.error,
                run1FailureCode: result.run1Result?.failureCode,
                run2Status: result.run2Result?.status,
                run2LastMessageIsUser: result.run2LastMessageIsUser,
                run2LastUserHasNoMemoryOrActiveState: result.run2LastUserHasNoMemoryOrActiveState,
                run2HistoryHasRun1User: result.run2HistoryHasRun1User,
                run2HistoryHasRun1Delivery: result.run2HistoryHasRun1Delivery,
                run2Delivery: result.run2Delivery
              }
            }
          )

          runtime.assertThat(Boolean(result.run2PrefixCache?.satisfied), {
            name: 'human-live-partner-continuation-reuses-run1-prefix-cache',
            message:
              'Run2 首次 brain 的 cachedInputTokens 应明显复用 Run1 末次 brain 的 inputTokens 前缀；低于公用跨 run 比例门槛说明前缀被改写或缓存未命中。',
            data: result.run2PrefixCache
              ? continuationPrefixCacheAssertionData(result.run2PrefixCache)
              : { run2PrefixCache: null }
          })
        }
      })
    })
  }, 1_800_000)
})
