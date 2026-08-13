import { describe, it } from 'vitest'
import { AiRunService } from '../../../../../src/main/services/ai/AiRunService'
import {
  invokeStructuredChat,
  type AiLlmDriver,
  type AiLlmStructuredDriverResult,
  type AiLlmTextDriverResult
} from '../../../../../src/main/services/ai/llmExecutor'
import type { AiRunDeps } from '../../../../../src/main/services/ai/types'
import type { AiRunEvent, JsonObject } from '../../../../../src/shared/types'
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
const INTERRUPTED_RUN_INPUT =
  '我想做一个复习对比小结。请先只看我刚选的深度学习课件，整理“过拟合/过度拟合”的概念定义、出现原因、处理方式；如果资料没写某一项就标成未写。为了节省时间，请先用 docx_search 搜索“过拟合/过度拟合”来定位，再只读取命中位置附近内容，不要先做全文 outline。后面我会再选另一份课件补第二个概念。'
const RESUMED_RUN_INPUT =
  '这次我新选了图形学课件。请保留刚才已经整理到的过拟合信息，再补充这份资料里的反走样信息，最后输出一个对比小结。资料没写的地方要直接说明未写。'

type LiveFaultInjectionState = {
  shouldFailNextBrain: boolean
  injected: boolean
}

const buildWorkspace = (runtime: BackendTestRuntime) => ({
  workspaceId: 'test-workspace',
  workspaceName: 'test-workspace',
  rootPath: runtime.workspaceRoot
})

const eventText = (event: AiRunEvent): string => JSON.stringify(event)

const hasOverfittingEvidence = (events: readonly AiRunEvent[]): boolean =>
  filterAiRunEventsByType(events, 'tool_call_result').some((event) => {
    const text = eventText(event)
    return (
      ['docx_search', 'docx_read_blocks'].includes(String(event.toolName || '')) &&
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

const hasResumeHintEvent = (events: readonly AiRunEvent[], runId: string): boolean =>
  events.some(
    (event) =>
      event.type === 'decision_hint' &&
      event.runId === runId &&
      event.code === 'run_resumed_after_interruption' &&
      event.detail?.reason === 'network_error'
  )

const runUsedSelectedFile = (
  events: readonly AiRunEvent[],
  runId: string,
  fileName: string
): boolean =>
  events.some(
    (event) =>
      event.runId === runId &&
      ['tool_call_started', 'tool_call_result'].includes(event.type) &&
      ['docx_search', 'docx_read_blocks'].includes(String(event.toolName || '')) &&
      eventText(event).includes(fileName)
  )

const createFaultAfterOverfittingDriver = (input: {
  runtime: BackendTestRuntime
  state: LiveFaultInjectionState
}): AiLlmDriver => ({
  chatStructured: async (request): Promise<AiLlmStructuredDriverResult> => {
    if (request.caller === 'human.brain' && input.state.shouldFailNextBrain) {
      input.state.shouldFailNextBrain = false
      input.state.injected = true
      throw new Error('fetch failed')
    }

    const result = await invokeStructuredChat({
      caller: request.caller,
      cfg: request.cfg,
      schema: request.schema,
      schemaName: request.schemaName,
      system: request.system,
      user: request.user,
      temperature: request.temperature,
      streamingMode: request.streamingMode
    })

    if (
      request.caller === 'human.brain' &&
      !input.state.injected &&
      hasOverfittingEvidence(input.runtime.eventCollector.snapshot())
    ) {
      input.state.shouldFailNextBrain = true
    }

    return {
      output: result.output as JsonObject,
      rawText: result.rawText,
      streamed: result.streamed,
      usage: result.usage,
      responseMetadata: result.responseMetadata,
      usageMetadata: result.usageMetadata
    }
  },
  chatText: async (): Promise<AiLlmTextDriverResult> => {
    if (!input.state.injected && hasOverfittingEvidence(input.runtime.eventCollector.snapshot())) {
      input.state.injected = true
      throw new Error('fetch failed')
    }
    throw new Error('fault_injection_driver_text_not_expected_before_resume')
  }
})

const buildAiRunDeps = async (input: {
  runtime: BackendTestRuntime
  llmDriver?: AiLlmDriver
}): Promise<AiRunDeps> => {
  const controller = new AbortController()
  const runtimeSettings = await input.runtime.storageService.aiRuntimeSettings.get()
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
      await input.runtime.storageService.aiFileChange.saveRecord(record)
    },
    listFileChangeRecords: async (request) =>
      (await input.runtime.storageService.aiFileChange.listRecords(request)).items,
    isCancelled: () => controller.signal.aborted,
    abortSignal: controller.signal,
    sendEvent: (event) => input.runtime.eventCollector.add(event),
    recordLlmIo: (record) => input.runtime.eventCollector.addLlmIo(record),
    requestApprovalBatch: async () => ({ accepted: true, decisions: [] as never[] }),
    llmDriver: input.llmDriver
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
              snapshotAfterNetwork: null,
              snapshotAfterResume: null,
              injected: false,
              overfittingEvidenceBeforeFailure: false,
              resumeHintEventSeen: false,
              run2UsedFileB: false,
              run2BrainPrompt: '',
              run2Delivery: '',
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
            injected: false
          }

          await runtime.seedLlmConfig(liveConfig)
          await runtime.chatStore.saveChatSession({
            id: SESSION_ID,
            title: 'live session resume test',
            created_at: Date.now(),
            workspace_id: 'test-workspace'
          })
          const interruptedResult = await AiRunService.getInstance().run(
            {
              runId: `${runtime.runId}-run-1-interrupted`,
              sessionId: SESSION_ID,
              input: INTERRUPTED_RUN_INPUT,
              selectedReferences: fileAReferences,
              mainModel: {
                configId: liveConfig.id,
                modelName: liveConfig.model_name
              },
              workspace: buildWorkspace(runtime)
            },
            await buildAiRunDeps({
              runtime,
              llmDriver: createFaultAfterOverfittingDriver({
                runtime,
                state: faultState
              })
            })
          )
          const overfittingEvidenceBeforeFailure = hasOverfittingEvidence(
            runtime.eventCollector.snapshot()
          )
          const snapshotAfterNetwork = await runtime.chatStore.getSessionResumeSnapshot(SESSION_ID)

          const resumedResult = await AiRunService.getInstance().run(
            {
              runId: `${runtime.runId}-run-2-resume`,
              sessionId: SESSION_ID,
              input: RESUMED_RUN_INPUT,
              selectedReferences: fileBReferences,
              mainModel: {
                configId: liveConfig.id,
                modelName: liveConfig.model_name
              },
              workspace: buildWorkspace(runtime)
            },
            await buildAiRunDeps({ runtime })
          )
          const snapshotAfterResume = await runtime.chatStore.getSessionResumeSnapshot(SESSION_ID)
          const run2Events = runtime.eventCollector.snapshot()
          const run2Id = `${runtime.runId}-run-2-resume`
          const run2BrainPrompt = runtime.eventCollector
            .snapshotLlmIo()
            .filter((record) => record.runId === run2Id && record.caller === 'human.brain')
            .map((record) => record.user)
            .join('\n')

          return {
            configurationMissing: false,
            interruptedResult,
            resumedResult,
            snapshotAfterNetwork,
            snapshotAfterResume,
            injected: faultState.injected,
            overfittingEvidenceBeforeFailure,
            resumeHintEventSeen: hasResumeHintEvent(run2Events, run2Id),
            run2UsedFileB: runUsedSelectedFile(run2Events, run2Id, fileBReferences[0]?.name || ''),
            run2BrainPrompt,
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

          const snapshotText = JSON.stringify(result.snapshotAfterNetwork)
          runtime.assertThat(
            result.injected === true &&
              result.overfittingEvidenceBeforeFailure === true &&
              result.interruptedResult?.status === 'failed' &&
              result.interruptedResult.failureCode === 'network_error' &&
              result.interruptedResult.resumeSnapshotSaved === true &&
              result.snapshotAfterNetwork?.reason === 'network_error' &&
              /(过拟合|过度拟合)/.test(snapshotText) &&
              /(训练时间过久|记住过多训练数据|不太具有展望性)/.test(snapshotText) &&
              result.resumedResult?.status === 'completed' &&
              result.snapshotAfterResume === null &&
              result.resumeHintEventSeen === true &&
               result.run2UsedFileB === true &&
               result.run2BrainPrompt.includes('<conversation_history>') &&
               mentionsOverfittingTopic(result.run2BrainPrompt) &&
               mentionsAntiAliasingTopic(result.run2BrainPrompt),
            {
              name: 'human-live-session-resume-keeps-interrupted-context-and-uses-new-selection',
              message:
                'live 恢复 run 应在第一诉求已读到过拟合事实后保存快照，并在同 session 新诉求中使用旧过拟合上下文和本轮新选图形学课件的反走样事实完成对比小结。',
              data: {
                fileAName: result.fileAName,
                fileBName: result.fileBName,
                interruptedResult: result.interruptedResult,
                snapshotAfterNetwork: result.snapshotAfterNetwork,
                run2BrainPrompt: result.run2BrainPrompt
              }
            }
          )
        }
      })
    })
  })
})
