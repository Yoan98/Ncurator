import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { AiRunService } from '../../../../../src/main/services/ai/AiRunService'
import type { AiRunDeps } from '../../../../../src/main/services/ai/types'
import { AiFileChangeService } from '../../../../../src/main/services/ai/fileChanges/AiFileChangeService'
import type { AiRunEvent, SelectedReference } from '../../../../../src/shared/types'
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
const NOTE_FILE_NAME = 'cache-retain-note.txt'
const NOTE_BODY = [
  '项目代号：苍鹭',
  '发布窗口：九月第三周',
  '负责人：林可',
  ''
].join('\n')

const RUN1_INPUT =
  '请打开我选中的 cache-retain-note.txt，用一句话告诉我项目代号是什么。不要改文件，也不要学与阅读无关的新技能。'
const RUN2_INPUT =
  '还是这份笔记：发布窗口写的是哪一周？一句话回答即可，不要改文件。'
const RUN3_INPUT =
  '继续同一份笔记：负责人是谁？一句话确认即可，不要改文件。'

const TEXT_READ_TOOL_NAMES = new Set(['text_file_read', 'text_file_search'])

const buildNoteReference = (runtime: BackendTestRuntime, notePath: string): SelectedReference => {
  const relativePath = path.relative(runtime.workspaceRoot, notePath).split(path.sep).join('/')
  return {
    kind: 'file',
    workspaceId: 'test-workspace',
    nodeId: 'prefix-cache-retain-note',
    name: NOTE_FILE_NAME,
    relativePath,
    absolutePath: notePath,
    fileExt: '.txt',
    kbDocumentIds: [],
    kbAvailability: 'not_indexed'
  }
}

const runUsedTextReadTool = (events: readonly AiRunEvent[], runId: string): boolean =>
  events.some(
    (event) =>
      event.runId === runId &&
      ['tool_call_started', 'tool_call_result'].includes(event.type) &&
      TEXT_READ_TOOL_NAMES.has(String(event.toolName || ''))
  )

const toolsHashStable = (reuse: ContinuationPrefixCacheReuse): boolean => {
  const previous = reuse.previousLastBrain?.requestWire?.toolsHash
  const next = reuse.nextFirstBrain?.requestWire?.toolsHash
  return typeof previous === 'string' && previous.length > 0 && previous === next
}

const buildAiRunDeps = async (runtime: BackendTestRuntime): Promise<AiRunDeps> => {
  const controller = new AbortController()
  const aiFileChangeService = new AiFileChangeService(runtime.storageService.aiFileChange)
  return {
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
          '验证同伙伴三轮短续接（含文本读工具历史）时，相邻跨 run 前缀缓存与 toolsHash 保持稳定（发布准备必跑）。',
        fixtures: [],
        runMode: 'single',
        runtimeModelName: loadLiveLlmConfigFromEnv().model_name,
        execute: async (runtime) => {
          const liveConfig = loadLiveLlmConfigFromEnv()
          await runtime.seedLlmConfig(liveConfig)

          const notePath = path.join(runtime.workspaceRoot, NOTE_FILE_NAME)
          await fs.writeFile(notePath, NOTE_BODY, 'utf8')
          const selectedReferences = [buildNoteReference(runtime, notePath)]

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
          const runPartner = async (runSuffix: string, input: string) =>
            AiRunService.getInstance().run(
              {
                runId: `${runtime.runId}-${runSuffix}`,
                partnerId: PARTNER_ID,
                input,
                selectedReferences,
                mainModel: { configId: liveConfig.id, modelName: liveConfig.model_name },
                partnerName: '测试伙伴',
                workspaceRoots: [runtime.workspaceRoot]
              },
              deps
            )

          const run1Result = await runPartner('run-1', RUN1_INPUT)
          const run1LlmIo = runtime.eventCollector.snapshotLlmIo()
          const run1Events = runtime.eventCollector.snapshot()

          const run2Result = await runPartner('run-2', RUN2_INPUT)
          const allLlmIoAfterRun2 = runtime.eventCollector.snapshotLlmIo()
          const run2LlmIo = allLlmIoAfterRun2.slice(run1LlmIo.length)

          const run3Result = await runPartner('run-3', RUN3_INPUT)
          const allLlmIoAfterRun3 = runtime.eventCollector.snapshotLlmIo()
          const run3LlmIo = allLlmIoAfterRun3.slice(allLlmIoAfterRun2.length)

          return {
            run1Result,
            run2Result,
            run3Result,
            run1UsedTextRead: runUsedTextReadTool(run1Events, `${runtime.runId}-run-1`),
            run1ToRun2PrefixCache: collectContinuationPrefixCacheReuse({
              previousLlmIo: run1LlmIo,
              nextLlmIo: run2LlmIo
            }),
            run2ToRun3PrefixCache: collectContinuationPrefixCacheReuse({
              previousLlmIo: run2LlmIo,
              nextLlmIo: run3LlmIo
            })
          }
        },
        assert: async (result, runtime) => {
          runtime.assertThat(
            result.run1Result?.status === 'completed' &&
              result.run2Result?.status === 'completed' &&
              result.run3Result?.status === 'completed' &&
              result.run1UsedTextRead === true,
            {
              name: 'human-live-prefix-cache-retain-three-runs-with-text-read',
              message:
                '三轮均应完成，且 Run1 须实际调用文本读工具，才能覆盖含 tool 历史的跨 run 前缀缓存。',
              data: {
                run1Status: result.run1Result?.status,
                run1Error: result.run1Result?.error,
                run1FailureCode: result.run1Result?.failureCode,
                run2Status: result.run2Result?.status,
                run2Error: result.run2Result?.error,
                run3Status: result.run3Result?.status,
                run3Error: result.run3Result?.error,
                run1UsedTextRead: result.run1UsedTextRead
              }
            }
          )

          runtime.assertThat(
            Boolean(result.run1ToRun2PrefixCache?.satisfied) &&
              toolsHashStable(result.run1ToRun2PrefixCache),
            {
              name: 'human-live-prefix-cache-retain-run1-to-run2',
              message:
                'Run2 首次 brain 应明显复用 Run1 末次前缀缓存，且 toolsHash 与 Run1 末次一致。',
              data: {
                ...continuationPrefixCacheAssertionData(result.run1ToRun2PrefixCache),
                toolsHashStable: toolsHashStable(result.run1ToRun2PrefixCache)
              }
            }
          )

          runtime.assertThat(
            Boolean(result.run2ToRun3PrefixCache?.satisfied) &&
              toolsHashStable(result.run2ToRun3PrefixCache),
            {
              name: 'human-live-prefix-cache-retain-run2-to-run3',
              message:
                'Run3 首次 brain 应明显复用 Run2 末次前缀缓存，且 toolsHash 与 Run2 末次一致。',
              data: {
                ...continuationPrefixCacheAssertionData(result.run2ToRun3PrefixCache),
                toolsHashStable: toolsHashStable(result.run2ToRun3PrefixCache)
              }
            }
          )
        }
      })
    })
  })
})
