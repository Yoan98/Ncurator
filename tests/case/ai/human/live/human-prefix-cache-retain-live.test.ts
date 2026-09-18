import { describe, it } from 'vitest'
import { AiRunService } from '../../../../../src/main/services/ai/AiRunService'
import type { AiRunDeps } from '../../../../../src/main/services/ai/types'
import { AiFileChangeService } from '../../../../../src/main/services/ai/fileChanges/AiFileChangeService'
import { loadLiveLlmConfigFromEnv } from '../../../../harness/backend/llmConfig'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { BackendTestRuntime } from '../../../../harness/backend/test-types'
import {
  collectContinuationPrefixCacheReuse,
  continuationPrefixCacheAssertionData,
  type ContinuationPrefixCacheReuse
} from '../../../../harness/core/continuation-prefix-cache'
import { runWithStructuredOutputRetry } from '../testUtils'

const PARTNER_ID = 'live-partner-prefix-cache-retain'
const RUN1_INPUT = '请用一句话回答：一周有几天？不要调用任何工具。'
const RUN2_INPUT = '上一问的答案还记得吗？请再确认一次，仍然一句话，不要调用工具。'

const buildAiRunDeps = async (runtime: BackendTestRuntime): Promise<AiRunDeps> => {
  const controller = new AbortController()
  const runtimeSettings = await runtime.storageService.aiRuntimeSettings.get()
  const aiFileChangeService = new AiFileChangeService(runtime.storageService.aiFileChange)
  return {
    runtimeSettings,
    llmStore: runtime.llmStore,
    chatStore: runtime.chatStore,
    documentsStore: runtime.documentsStore,
    embeddingService: runtime.embeddingService,
    ensureEmbeddingReady: async () => {
      await runtime.ensureEmbeddingReady()
    },
    docxApplyService: runtime.docxApplyService,
    saveFileChangeRecord: async (record) => {
      await aiFileChangeService.saveRecord(record, runtime.workspaceRoot)
    },
    listFileChangeRecords: async (request) =>
      (await aiFileChangeService.listRecords(request)).items,
    chatMessageLogStore: runtime.storageService.chatMessageLog,
    isCancelled: () => controller.signal.aborted,
    abortSignal: controller.signal,
    sendEvent: (event) => runtime.eventCollector.add(event),
    recordLlmIo: (record) => runtime.eventCollector.addLlmIo(record),
    requestApprovalBatch: async () => ({ accepted: true, decisions: [] as never[] })
  }
}

describe('ai human live backend', () => {
  it('human-prefix-cache-retain-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-prefix-cache-retain-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description:
          '验证同伙伴短续接时 Run2 首轮 brain 明显复用 Run1 末次前缀缓存（发布准备必跑）。',
        fixtures: [],
        runMode: 'single',
        runtimeModelName: loadLiveLlmConfigFromEnv().model_name,
        execute: async (runtime) => {
          const liveConfig = loadLiveLlmConfigFromEnv()
          await runtime.seedLlmConfig(liveConfig)
          await runtime.chatStore.savePartner({
            id: PARTNER_ID,
            name: 'live partner prefix cache retain',
            avatar_shape: 'circle',
            avatar_color: 'blue',
            created_at: Date.now(),
            updated_at: Date.now(),
            last_viewed_at: Date.now(),
            pinned: false,
            pinned_at: null
          })

          const deps = await buildAiRunDeps(runtime)
          const run1Result = await AiRunService.getInstance().run(
            {
              runId: `${runtime.runId}-run-1`,
              partnerId: PARTNER_ID,
              input: RUN1_INPUT,
              selectedReferences: [],
              mainModel: { configId: liveConfig.id, modelName: liveConfig.model_name },
              partnerName: '测试伙伴',
              workspaceRoots: [runtime.workspaceRoot]
            },
            deps
          )
          const run1LlmIo = runtime.eventCollector.snapshotLlmIo()

          const run2Result = await AiRunService.getInstance().run(
            {
              runId: `${runtime.runId}-run-2`,
              partnerId: PARTNER_ID,
              input: RUN2_INPUT,
              selectedReferences: [],
              mainModel: { configId: liveConfig.id, modelName: liveConfig.model_name },
              partnerName: '测试伙伴',
              workspaceRoots: [runtime.workspaceRoot]
            },
            deps
          )
          const run2LlmIo = runtime.eventCollector.snapshotLlmIo().slice(run1LlmIo.length)
          const run2PrefixCache: ContinuationPrefixCacheReuse =
            collectContinuationPrefixCacheReuse({
              previousLlmIo: run1LlmIo,
              nextLlmIo: run2LlmIo
            })

          return { run1Result, run2Result, run2PrefixCache }
        },
        assert: async (result, runtime) => {
          runtime.assertThat(
            result.run1Result?.status === 'completed' && result.run2Result?.status === 'completed',
            {
              name: 'human-live-prefix-cache-retain-both-runs-completed',
              message: '同伙伴两轮短续接均应完成，才能断言跨 run 前缀缓存。',
              data: {
                run1Status: result.run1Result?.status,
                run1Error: result.run1Result?.error,
                run1FailureCode: result.run1Result?.failureCode,
                run2Status: result.run2Result?.status,
                run2Error: result.run2Result?.error,
                run2FailureCode: result.run2Result?.failureCode
              }
            }
          )

          runtime.assertThat(Boolean(result.run2PrefixCache?.satisfied), {
            name: 'human-live-prefix-cache-retain-reuses-run1-prefix',
            message:
              'Run2 首次 brain 的 cachedInputTokens 应明显复用 Run1 末次 brain 的 inputTokens 前缀；低于公用跨 run 比例门槛说明前缀被改写或缓存未命中。',
            data: continuationPrefixCacheAssertionData(result.run2PrefixCache)
          })
        }
      })
    })
  })
})
