import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import type { AiLlmIoRecord, AiRunEvent } from '../../../../../src/shared/types'
import {
  collectContinuationPrefixCacheReuse,
  continuationPrefixCacheAssertionData,
  type ContinuationPrefixCacheReuse
} from '../../../../harness/core/continuation-prefix-cache'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  appendWorkbenchInputText,
  assertNoWorkbenchFakeSignals,
  clampWorkbenchPartnerName,
  collectWorkbenchLlmIoRecords,
  configureLiveModelThroughSettingsUi,
  createPartnerThroughWorkbenchUi,
  createTemporaryWorkbenchWorkspace,
  getWorkbenchReferenceTokenTexts,
  insertWorkbenchReferenceToken,
  loadWorkbenchLiveModelEnv,
  prepareWorkbenchWorkspaceThroughUi,
  recordWorkbenchAiEvidence,
  selectWorkbenchModel,
  submitWorkbenchCurrentDraft,
  waitForWorkbenchAiRunCompletion
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'prefix-cache-retain-live'
const NOTE_FILE_NAME = 'cache-retain-note.txt'
const NOTE_BODY = ['项目代号：苍鹭', '发布窗口：九月第三周', '负责人：林可', ''].join('\n')
const RUN1_INPUT =
  '请打开我选中的 cache-retain-note.txt，用一句话告诉我项目代号是什么。不要改文件，也不要学与阅读无关的新技能。'
const RUN2_INPUT = '还是这份笔记：发布窗口写的是哪一周？一句话回答即可，不要改文件。'
const RUN3_INPUT = '继续同一份笔记：负责人是谁？一句话确认即可，不要改文件。'
const TEXT_READ_TOOL_NAMES = new Set(['text_file_read', 'text_file_search'])

const runUsedTextReadTool = (events: readonly AiRunEvent[]): boolean =>
  events.some(
    (event) =>
      ['tool_call_started', 'tool_call_result'].includes(event.type) &&
      TEXT_READ_TOOL_NAMES.has(String(event.toolName || ''))
  )

const toolsHashStable = (reuse: ContinuationPrefixCacheReuse): boolean => {
  const previous = reuse.previousLastBrain?.requestWire?.toolsHash
  const next = reuse.nextFirstBrain?.requestWire?.toolsHash
  return typeof previous === 'string' && previous.length > 0 && previous === next
}

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['prefix-cache'],
        description:
          '验证同伙伴三轮短续接（含文本读工具历史）时，相邻跨 run 前缀缓存与 toolsHash 保持稳定（发布准备必跑）。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const env = loadWorkbenchLiveModelEnv()
          const workspace = await createTemporaryWorkbenchWorkspace(CASE_ID, 'empty')
          await writeFile(path.join(workspace.rootPath, NOTE_FILE_NAME), NOTE_BODY, 'utf8')
          const workspaceName = clampWorkbenchPartnerName(`Workbench ${CASE_ID}`)
          await configureLiveModelThroughSettingsUi(page, env)
          await prepareWorkbenchWorkspaceThroughUi(page, {
            workspaceName,
            rootPath: workspace.rootPath
          })
          await createPartnerThroughWorkbenchUi(page, workspaceName)
          await selectWorkbenchModel(page, env.modelName)

          const sendReferencedNote = async (input: string): Promise<void> => {
            await insertWorkbenchReferenceToken(page, NOTE_FILE_NAME)
            await appendWorkbenchInputText(page, input)
            const tokenTexts = await getWorkbenchReferenceTokenTexts(page)
            if (!tokenTexts.some((text) => text.includes(NOTE_FILE_NAME))) {
              throw new Error(
                `composer 发送前缺少 @${NOTE_FILE_NAME} token：${JSON.stringify(tokenTexts)}`
              )
            }
            await submitWorkbenchCurrentDraft(page)
          }

          const runIdOf = (events: readonly AiRunEvent[]): string => {
            const started = events.find(
              (event): event is Extract<AiRunEvent, { type: 'run_started' }> =>
                event.type === 'run_started'
            )
            if (!started?.runId) {
              throw new Error('AI run completion evidence is missing run_started.runId')
            }
            return started.runId
          }

          const waitForRunLlmIo = async (runId: string): Promise<AiLlmIoRecord[]> => {
            const deadline = Date.now() + 15_000
            for (;;) {
              const records = (await collectWorkbenchLlmIoRecords(runtime)).filter(
                (record) => record.runId === runId
              )
              if (records.some((record) => record.caller === 'human.brain')) return records
              if (Date.now() >= deadline) return records
              await page.waitForTimeout(200)
            }
          }

          const startedAt1 = Date.now()
          await sendReferencedNote(RUN1_INPUT)
          const evidence1 = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAt1,
            env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page }
          )
          recordWorkbenchAiEvidence(runtime, evidence1, 0.8)
          const run1LlmIo = await waitForRunLlmIo(runIdOf(evidence1.events))

          const startedAt2 = Date.now()
          await sendReferencedNote(RUN2_INPUT)
          const evidence2 = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAt2,
            env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page }
          )
          recordWorkbenchAiEvidence(runtime, evidence2, 0.8)
          const run2LlmIo = await waitForRunLlmIo(runIdOf(evidence2.events))

          const startedAt3 = Date.now()
          await sendReferencedNote(RUN3_INPUT)
          const evidence3 = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAt3,
            env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page }
          )
          recordWorkbenchAiEvidence(runtime, evidence3, 0.8)
          const run3LlmIo = await waitForRunLlmIo(runIdOf(evidence3.events))

          return {
            run1Status: 'completed' as const,
            run2Status: 'completed' as const,
            run3Status: 'completed' as const,
            run1UsedTextRead: runUsedTextReadTool(evidence1.events),
            run1ToRun2PrefixCache: collectContinuationPrefixCacheReuse({
              previousRunId: runIdOf(evidence1.events),
              nextRunId: runIdOf(evidence2.events),
              previousLlmIo: run1LlmIo,
              nextLlmIo: run2LlmIo
            }),
            run2ToRun3PrefixCache: collectContinuationPrefixCacheReuse({
              previousRunId: runIdOf(evidence2.events),
              nextRunId: runIdOf(evidence3.events),
              previousLlmIo: run2LlmIo,
              nextLlmIo: run3LlmIo
            })
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.run1Status === 'completed' &&
              result.run2Status === 'completed' &&
              result.run3Status === 'completed' &&
              result.run1UsedTextRead === true,
            {
              name: 'prefix-cache-retain-three-runs-with-text-read',
              message:
                '三轮均应完成，且 Run1 须实际调用文本读工具，才能覆盖含 tool 历史的跨 run 前缀缓存。',
              data: {
                run1Status: result.run1Status,
                run2Status: result.run2Status,
                run3Status: result.run3Status,
                run1UsedTextRead: result.run1UsedTextRead
              }
            }
          )

          await runtime.assertThat(
            Boolean(result.run1ToRun2PrefixCache.satisfied) &&
              toolsHashStable(result.run1ToRun2PrefixCache),
            {
              name: 'prefix-cache-retain-run1-to-run2',
              message:
                'Run2 首次 brain 应明显复用 Run1 末次前缀缓存，且 toolsHash 与 Run1 末次一致。',
              data: {
                ...continuationPrefixCacheAssertionData(result.run1ToRun2PrefixCache),
                toolsHashStable: toolsHashStable(result.run1ToRun2PrefixCache)
              }
            }
          )

          await runtime.assertThat(
            Boolean(result.run2ToRun3PrefixCache.satisfied) &&
              toolsHashStable(result.run2ToRun3PrefixCache),
            {
              name: 'prefix-cache-retain-run2-to-run3',
              message:
                'Run3 首次 brain 应明显复用 Run2 末次前缀缓存，且 toolsHash 与 Run2 末次一致。',
              data: {
                ...continuationPrefixCacheAssertionData(result.run2ToRun3PrefixCache),
                toolsHashStable: toolsHashStable(result.run2ToRun3PrefixCache)
              }
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS * 3
  )
})
