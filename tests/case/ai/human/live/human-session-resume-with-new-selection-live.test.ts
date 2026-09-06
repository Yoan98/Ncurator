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
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const SESSION_ID = 'live-session-resume-with-new-selection'
const MIN_BRAIN_ROUNDS_BEFORE_FAULT = 5
const INTERRUPTED_RUN_INPUT =
  '我想做一个复习对比小结。请先只看深度学习课件，整理“过拟合/过度拟合”的概念定义、出现原因、处理方式；整理时先在资料里定位相关段落并读取原文，再交叉核对“训练时间”和“测试集”这两个相关知识点是否也提到了过拟合的原因和处理方法；整理完更新你的执行计划，并把结果写入工作区草稿文件 复习草稿.md。资料没写某一项就标成未写。后面我会再选另一份课件补第二个概念。'
const RESUMED_RUN_INPUT =
  '这次我新选了图形学课件。请保留刚才已经整理到的过拟合信息，再补充这份资料里的反走样信息，最后输出一个对比小结。资料没写的地方要直接说明未写。'

type LiveFaultInjectionState = {
  shouldFailNextBrain: boolean
  injected: boolean
  brainRoundCount: number
}

const eventText = (event: AiRunEvent): string => JSON.stringify(event)

const hasOverfittingEvidence = (events: readonly AiRunEvent[]): boolean =>
  filterAiRunEventsByType(events, 'tool_call_result').some((event) => {
    const text = eventText(event)
    return (
      ['docx_search', 'docx_read_nodes'].includes(String(event.toolName || '')) &&
      /深度学习\.docx/.test(text) &&
      /(过拟合|过度拟合)/.test(text) &&
      /(训练时间过久|记住过多训练数据|只针对于这部分训练数据|不太具有展望性)/.test(text)
    )
  })

const normalizeText = (text: string): string => text.normalize('NFKC')

const mentionsOverfittingTopic = (text: string): boolean =>
  /(过拟合|过度拟合|overfitting)/i.test(normalizeText(text))

const mentionsAntiAliasingTopic = (text: string): boolean =>
  /(反走样|抗锯齿|anti-?aliasing)/i.test(normalizeText(text))

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

const createFaultAfterOverfittingWrapper =
  (input: {
    runtime: BackendTestRuntime
    state: LiveFaultInjectionState
  }): NonNullable<AiRunDeps['chatToolsWrapper']> =>
  (realChatTools) =>
  async (request) => {
    if (request.caller === 'human.brain') {
      input.state.brainRoundCount += 1
    }

    if (request.caller === 'human.brain' && input.state.shouldFailNextBrain) {
      input.state.shouldFailNextBrain = false
      input.state.injected = true
      throw new Error('fetch failed')
    }

    const result = await realChatTools(request)

    if (
      request.caller === 'human.brain' &&
      !input.state.injected &&
      input.state.brainRoundCount >= MIN_BRAIN_ROUNDS_BEFORE_FAULT &&
      hasOverfittingEvidence(input.runtime.eventCollector.snapshot())
    ) {
      input.state.shouldFailNextBrain = true
    }

    return result
  }

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
  it('human-session-resume-with-new-selection-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-session-resume-with-new-selection-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description:
          '验证 live 模式下第一诉求已沉淀局部事实后发生网络中断，同一 session 新诉求能恢复旧语义上下文并覆盖本轮新选择文件。',
        fixtures: [SHARED_WORKSPACE_FIXTURE_PATH],
        runMode: 'single',
        runtimeModelName: loadLiveLlmConfigFromEnv().model_name,
        execute: async (runtime) => {
          if (!loadLiveLlmConfigFromEnv()) {
            return {
              configurationMissing: true,
              interruptedResult: null,
              resumedResult: null,
              logAfterNetwork: [],
              logAfterResume: [],
              injected: false,
              overfittingEvidenceBeforeFailure: false,
              run2UsedFileB: false,
              run2BrainPrompt: '',
              run2Delivery: '',
              run2LastMessageIsUser: false,
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
          const faultState: LiveFaultInjectionState = {
            shouldFailNextBrain: false,
            injected: false,
            brainRoundCount: 0
          }

          await runtime.seedLlmConfig(liveConfig)
          await runtime.chatStore.savePartner({
          id: SESSION_ID,
          name: 'live session resume test',
          avatar_shape: 'circle',
          avatar_color: 'blue',
          created_at: Date.now(),
          updated_at: Date.now(),
          last_viewed_at: Date.now(),
          pinned: false,
          pinned_at: null
        })
          const interruptedResult = await AiRunService.getInstance().run(
            {
              runId: `${runtime.runId}-run-1-interrupted`,
              partnerId: SESSION_ID,
              input: INTERRUPTED_RUN_INPUT,
              selectedReferences: fileAReferences,
              mainModel: {
                configId: liveConfig.id,
                modelName: liveConfig.model_name
              },
              partnerName: '测试伙伴',
              workspaceRoots: [runtime.workspaceRoot]
            },
            await buildAiRunDeps({
              runtime,
              chatToolsWrapper: createFaultAfterOverfittingWrapper({
                runtime,
                state: faultState
              })
            })
          )
          const overfittingEvidenceBeforeFailure = hasOverfittingEvidence(
            runtime.eventCollector.snapshot()
          )
          const logAfterNetwork = await runtime.storageService.chatMessageLog.list(SESSION_ID)

          let run2BrainMessages: BaseMessage[] | null = null
          const captureRun2Wrapper: NonNullable<AiRunDeps['chatToolsWrapper']> =
            (realChatTools) => async (request) => {
              if (request.caller === 'human.brain' && !run2BrainMessages) {
                run2BrainMessages = [...request.messages]
              }
              return await realChatTools(request)
            }
          const resumedResult = await AiRunService.getInstance().run(
            {
              runId: `${runtime.runId}-run-2-resume`,
              partnerId: SESSION_ID,
              input: RESUMED_RUN_INPUT,
              selectedReferences: fileBReferences,
              mainModel: {
                configId: liveConfig.id,
                modelName: liveConfig.model_name
              },
              partnerName: '测试伙伴',
              workspaceRoots: [runtime.workspaceRoot]
            },
            await buildAiRunDeps({ runtime, chatToolsWrapper: captureRun2Wrapper })
          )
          const logAfterResume = await runtime.storageService.chatMessageLog.list(SESSION_ID)
          const run2Events = runtime.eventCollector.snapshot()
          const run2Id = `${runtime.runId}-run-2-resume`
          const run2BrainPrompt = runtime.eventCollector
            .snapshotLlmIo()
            .filter((record) => record.runId === run2Id && record.caller === 'human.brain')
            .map((record) => record.user)
            .join('\n')
          const run2LastMessage = run2BrainMessages
            ? run2BrainMessages[run2BrainMessages.length - 1]
            : null
          const run2LastMessageIsUser =
            run2LastMessage?.getType() === 'human' &&
            typeof run2LastMessage.content === 'string' &&
            run2LastMessage.content.includes('<task_goal>')
          const run2MessageTypes = run2BrainMessages?.map((message) => message.getType()) || []
          const run2HasOnlyCurrentBrainUser =
            run2BrainMessages?.filter((message) => message.getType() === 'human').length === 1 &&
            run2BrainMessages?.[run2BrainMessages.length - 1]?.getType() === 'human'

          return {
            configurationMissing: false,
            interruptedResult,
            resumedResult,
            logAfterNetwork,
            logAfterResume,
            injected: faultState.injected,
            overfittingEvidenceBeforeFailure,
            run2UsedFileB: runUsedSelectedFile(run2Events, run2Id, fileBReferences[0]?.name || ''),
            run2BrainPrompt,
            run2LastMessageIsUser,
            run2MessageTypes,
            run2HasOnlyCurrentBrainUser,
            fileAName: fileAReferences[0]?.name || '',
            fileBName: fileBReferences[0]?.name || ''
          }
        },
        assert: async (result, runtime) => {
          if (result.configurationMissing) {
            runtime.assertThat(false, {
              name: 'live-config-not-provided',
              message:
                '未提供 live 模型配置，已跳过 human session resume with new selection live case。'
            })
            return
          }

          const logText = JSON.stringify(result.logAfterNetwork)
          runtime.assertThat(
            result.injected === true &&
              result.overfittingEvidenceBeforeFailure === true &&
              result.interruptedResult?.status === 'failed' &&
              result.interruptedResult.failureCode === 'network_error' &&
              /docx-read/.test(logText) &&
              result.resumedResult?.status === 'completed' &&
              result.logAfterResume.length > result.logAfterNetwork.length &&
              result.run2UsedFileB === true &&
              result.run2BrainPrompt.includes('<active_state>') &&
              mentionsOverfittingTopic(result.run2BrainPrompt) &&
              /(训练时间过久|记住过多训练数据|不太具有展望性)/.test(result.run2BrainPrompt) &&
              mentionsAntiAliasingTopic(result.run2BrainPrompt) &&
              result.run2LastMessageIsUser,
              result.run2MessageTypes[0] === 'system' &&
              result.run2MessageTypes[result.run2MessageTypes.length - 1] === 'human' &&
              result.run2HasOnlyCurrentBrainUser,
            {
              name: 'human-live-session-resume-keeps-interrupted-context-and-uses-new-selection',
              message:
                'live 恢复 run 应在第一诉求已读到过拟合事实后保留不可变消息日志，并在同 session 新诉求中通过日志投影恢复旧过拟合上下文、使用本轮新选图形学课件的反走样事实完成对比小结；run-2 消息数组末尾应为 buildBrainUserMessage 的 user 消息。',
              data: {
                fileAName: result.fileAName,
                fileBName: result.fileBName,
                interruptedResult: result.interruptedResult,
                logAfterNetwork: result.logAfterNetwork,
                run2BrainPrompt: result.run2BrainPrompt,
                run2LastMessageIsUser: result.run2LastMessageIsUser
              }
            }
          )
        }
      })
    })
  })
})
