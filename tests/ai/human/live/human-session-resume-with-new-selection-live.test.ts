import { describe, it } from 'vitest'
import { AiRunService } from '../../../../src/main/services/ai/AiRunService'
import { updateConversationMemoryAfterRun } from '../../../../src/main/services/ai/memory'
import type { AiRunDeps } from '../../../../src/main/services/ai/types'
import { hasLiveLlmConfigInEnv, loadLiveLlmConfigFromEnv } from '../../../harness/backend/llmConfig'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { BackendTestRuntime, LiveLlmConfig } from '../../../harness/backend/test-types'
import {
  buildSelectedDocxFixtureReferences,
  DOCX_READING_FIXTURE_PATHS,
  SHARED_WORKSPACE_FIXTURE_PATH
} from '../../../harness/backend/aiLiveTestData'
import { runWithStructuredOutputRetry } from '../testUtils'

const SESSION_ID = 'live-session-resume-with-new-selection'
const FIRST_RUN_INPUT =
  '请只基于我刚选的深度学习课件里“过拟合/过度拟合”命中位置附近已经写出的内容，提炼一套后续判断复习材料是否讲清楚某个概念时要沿用的检查规则。规则只需要覆盖：概念定义、出现原因、处理方式；如果资料未写某一项，就直接把“未写时要明确说明未写”写进规则里，不要继续扩展搜索其他处理方案，也不要展开讲别的概念。'
const SECOND_RUN_INPUT =
  '我先继续这个任务，稍后会换一个文件继续判断。'
const THIRD_RUN_INPUT =
  '继续，但这次改用我刚刚新选的文件。请沿用刚才那套检查规则，判断这份资料里的反走样是否讲清楚：概念定义、出现原因、处理方式；资料没写的地方要直接说明。'

const buildWorkspace = (runtime: BackendTestRuntime) => ({
  workspaceId: 'test-workspace',
  workspaceName: 'test-workspace',
  rootPath: runtime.workspaceRoot
})

const buildBrokenConfig = (liveConfig: LiveLlmConfig): LiveLlmConfig => ({
  ...liveConfig,
  id: 'ai-live-broken-network-config',
  providerKind: 'openai-compatible',
  base_url: 'http://127.0.0.1:9/v1'
})

const buildAiRunDeps = async (input: {
  runtime: BackendTestRuntime
  controller?: AbortController
}): Promise<AiRunDeps> => {
  const controller = input.controller || new AbortController()
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
    fileReviewService: input.runtime.fileReviewService,
    isCancelled: () => controller.signal.aborted,
    abortSignal: controller.signal,
    sendEvent: (event) => input.runtime.eventCollector.add(event),
    recordLlmIo: (record) => input.runtime.eventCollector.addLlmIo(record),
    requestApprovalBatch: async () => ({ accepted: true, decisions: [] as never[] })
  }
}

const hasRuleContinuity = (text: string): boolean =>
  /概念定义|定义/.test(text) &&
  /出现原因|原因/.test(text) &&
  /处理方式|处理方法|怎么处理/.test(text) &&
  /未写|没写|未提及|未说明/.test(text)

const hasAntiAliasingFacts = (text: string): boolean =>
  /反走样/.test(text) &&
  (/(采样频率低于信号频率|像素.*边界|锯齿|走样)/.test(text) ||
    /(低通滤波|多个采样点|多个像素点|多次采样)/.test(text))

const doesNotTreatFileAAsCurrentSelection = (input: { delivery: string; fileAName: string }): boolean =>
  !new RegExp(
    `(当前|这次|本轮|刚刚新选).*${input.fileAName}|${input.fileAName}.*(当前|这次|本轮|刚刚新选)`
  ).test(input.delivery)

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
          '验证 live 模式下同一 session 在网络中断后可恢复旧语义上下文，同时本轮新选择文件会覆盖中断快照里的旧选择范围。',
        fixtures: [SHARED_WORKSPACE_FIXTURE_PATH],
        runMode: 'single',
        runtimeModelName: hasLiveLlmConfigInEnv() ? loadLiveLlmConfigFromEnv().model_name : null,
        execute: async (runtime) => {
          if (!hasLiveLlmConfigInEnv()) {
            return {
              skipped: true,
              firstResult: null,
              networkResult: null,
              resumedResult: null,
              run3BrainPrompt: '',
              run3Delivery: '',
              snapshotAfterNetwork: null,
              snapshotAfterResume: null,
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
          const firstResult = await AiRunService.getInstance().run(
            {
              runId: `${runtime.runId}-run-1`,
              sessionId: SESSION_ID,
              input: FIRST_RUN_INPUT,
              selectedReferences: fileAReferences,
              modelName: liveConfig.model_name,
              workspace: buildWorkspace(runtime)
            },
            await buildAiRunDeps({ runtime })
          )

          await updateConversationMemoryAfterRun({
            runId: `${runtime.runId}-memory-1`,
            sessionId: SESSION_ID,
            userInput: FIRST_RUN_INPUT,
            assistantOutput: firstResult.finalDeliveryMarkdown || '',
            artifacts: firstResult.finalArtifacts || [],
            runtimeSettings: await runtime.storageService.aiRuntimeSettings.get(),
            chatStore: runtime.chatStore,
            llmStore: runtime.llmStore,
            modelName: liveConfig.model_name,
            sendEvent: (event) => runtime.eventCollector.add(event),
            recordLlmIo: (record) => runtime.eventCollector.addLlmIo(record)
          })
          await runtime.seedChatHistory({
            sessionId: SESSION_ID,
            messages: [
              {
                id: 'resume-selection-user-1',
                role: 'user',
                content: FIRST_RUN_INPUT,
                timestamp: Date.now()
              },
              {
                id: 'resume-selection-assistant-1',
                role: 'assistant',
                content: firstResult.finalDeliveryMarkdown || '',
                timestamp: Date.now() + 1,
                artifacts: firstResult.finalArtifacts
              }
            ]
          })

          await runtime.seedLlmConfig(buildBrokenConfig(liveConfig))
          const networkResult = await AiRunService.getInstance().run(
            {
              runId: `${runtime.runId}-run-2-network`,
              sessionId: SESSION_ID,
              input: SECOND_RUN_INPUT,
              selectedReferences: fileAReferences,
              modelName: liveConfig.model_name,
              workspace: buildWorkspace(runtime)
            },
            await buildAiRunDeps({ runtime })
          )
          const snapshotAfterNetwork = await runtime.chatStore.getSessionResumeSnapshot(SESSION_ID)

          await runtime.seedLlmConfig(liveConfig)
          const resumedResult = await AiRunService.getInstance().run(
            {
              runId: `${runtime.runId}-run-3-resume`,
              sessionId: SESSION_ID,
              input: THIRD_RUN_INPUT,
              selectedReferences: fileBReferences,
              modelName: liveConfig.model_name,
              workspace: buildWorkspace(runtime)
            },
            await buildAiRunDeps({ runtime })
          )
          const snapshotAfterResume = await runtime.chatStore.getSessionResumeSnapshot(SESSION_ID)
          const run3BrainPrompt =
            runtime.eventCollector
              .snapshotLlmIo()
              .filter(
                (record) =>
                  record.runId === `${runtime.runId}-run-3-resume` &&
                  record.caller === 'human.brain'
              )
              .at(-1)?.user || ''

          return {
            skipped: false,
            firstResult,
            networkResult,
            resumedResult,
            run3BrainPrompt,
            run3Delivery: resumedResult.finalDeliveryMarkdown || '',
            snapshotAfterNetwork,
            snapshotAfterResume,
            fileAName: fileAReferences[0]?.name || '',
            fileBName: fileBReferences[0]?.name || ''
          }
        },
        assert: async (result, runtime) => {
          if (result.skipped) {
            runtime.assertThat(true, {
              name: 'live-config-not-provided',
              message:
                '未提供 live 模型配置，已跳过 human session resume with new selection live case。'
            })
            return
          }

          runtime.assertThat(
            result.firstResult?.status === 'completed' &&
              result.networkResult?.status === 'failed' &&
              result.networkResult.failureCode === 'network_error' &&
              result.networkResult.resumeSnapshotSaved === true &&
              result.snapshotAfterNetwork?.reason === 'network_error' &&
              result.resumedResult?.status === 'completed' &&
              result.snapshotAfterResume === null &&
              result.run3BrainPrompt.includes('上一次运行因 network_error 中断') &&
              result.run3BrainPrompt.includes('当前用户最新输入、当前 selected references、当前 workspace 是本轮唯一有效入口') &&
              result.run3BrainPrompt.includes(result.fileBName) &&
              result.run3BrainPrompt.includes('资料未写某一项，要直接说明未写') &&
              hasRuleContinuity(result.run3BrainPrompt) &&
              hasAntiAliasingFacts(result.run3Delivery) &&
              result.run3Delivery.includes('反走样') &&
              doesNotTreatFileAAsCurrentSelection({
                delivery: result.run3Delivery,
                fileAName: result.fileAName
              }),
            {
              name: 'human-live-session-resume-uses-new-selection-and-old-context',
              message:
                'live 恢复 run 应看到恢复 hint，使用本轮新选择文件 B 的反走样事实，同时沿用第一轮建立的判断规则；不应把文件 A 的过拟合内容当作本轮交付主体。',
              data: {
                fileAName: result.fileAName,
                fileBName: result.fileBName,
                networkResult: result.networkResult,
                snapshotAfterNetwork: result.snapshotAfterNetwork,
                run3BrainPrompt: result.run3BrainPrompt,
                run3Delivery: result.run3Delivery
              }
            }
          )
        }
      })
    })
  })
})
