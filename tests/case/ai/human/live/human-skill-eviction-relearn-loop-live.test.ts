import { assertRunFileReviews } from '../../../../harness/backend/fileReviewAssertions'
import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import type { AiRunEvent, ChatMessageLogRecord } from '../../../../../src/shared/types'
import {
  DOCX_READING_FIXTURE_PATHS,
  PDF_READING_FIXTURE_PATH,
  SHARED_WORKSPACE_FIXTURE_PATH
} from '../../../../harness/backend/aiLiveTestData'
import { createAiServiceTestRunner } from '../../../../harness/backend/aiServiceHarness'
import { loadLiveLlmConfigFromEnv } from '../../../../harness/backend/llmConfig'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  collectContinuationPrefixCacheReuse,
  continuationPrefixCacheAssertionData,
  type ContinuationPrefixCacheReuse
} from '../../../../harness/core/continuation-prefix-cache'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const PARTNER_ID = 'live-skill-eviction-relearn'
const PPT_FIXTURE_PATH = `${SHARED_WORKSPACE_FIXTURE_PATH}/品牌策略提案.pptx` as const
const EXCEL_FIXTURE_PATH = `${SHARED_WORKSPACE_FIXTURE_PATH}/经营周报.xlsx` as const
const DOCX_NAME = '深度学习.docx'
const PDF_NAME = '深度学习.pdf'
const PPT_NAME = '品牌策略提案.pptx'
const EXCEL_NAME = '经营周报.xlsx'
const MEMO_NAME = '技能盘点备忘.docx'

const RUN1_USER_INPUT = [
  '我想先把几份资料的关键信息摸清楚，请严格按顺序处理，完成一步再做下一步：',
  `1）先打开《学习笔记/${DOCX_NAME}》，用一两句话说明里面关于过拟合/过度拟合的要点；`,
  `2）再打开《学习笔记/${PDF_NAME}》，补充一条和训练/拟合相关的要点；`,
  `3）再打开《${PPT_NAME}》，记下 KPI 页里一个关键数字（例如 85%）；`,
  `4）最后看一眼《${EXCEL_NAME}》有哪些工作表名称。`,
  '不要修改这些源文件，最后给我一份很短的口头汇总即可。'
].join('')

const RUN2_USER_INPUT = [
  `请继续：新建一份 Word 备忘《${MEMO_NAME}》，把刚才汇总的要点写进去；`,
  `另外在《${PPT_NAME}》末尾加一页极简附录页（标题写成「技能盘点附录」即可）。`,
  `源课件《学习笔记/${DOCX_NAME}》《学习笔记/${PDF_NAME}》和《${EXCEL_NAME}》不要改。`
].join('')

const RUN3_USER_INPUT = [
  `请再打开《学习笔记/${DOCX_NAME}》，核对《${MEMO_NAME}》里关于过拟合的表述是否和课件一致；`,
  '如有出入，以课件为准改备忘，并在最终答复里说明你核对过。'
].join('')

const readLatestLearnedSkillIds = (records: ChatMessageLogRecord[]): string[] => {
  let learnedSkillIds: string[] = []
  for (const record of records) {
    const entry = record.entry
    if (entry.kind === 'annotation' && entry.eventType === 'skill_state_updated') {
      learnedSkillIds = [...entry.payload.learnedSkillIds]
    }
  }
  return learnedSkillIds
}

const collectLearningEvictionEvidence = (events: readonly AiRunEvent[]) => {
  const learningSteps = filterAiRunEventsByType(events, 'human_step').filter(
    (event) => event.stage === 'human_learning'
  )
  const evictionSummaries = learningSteps
    .map((event) => event.summary)
    .filter((summary) => summary.includes('已淘汰最早学习的 skill='))
  const learnSkillResults = filterAiRunEventsByType(events, 'tool_call_result').filter(
    (event) => event.toolName === 'learn_skill'
  )
  const resultText = JSON.stringify(learnSkillResults)
  const docxReadEvictionIndex = learningSteps.findIndex((event) =>
    /已淘汰最早学习的 skill=\[[^\]]*docx-read/.test(event.summary)
  )
  const docxReadRelearnAfterEviction =
    docxReadEvictionIndex >= 0 &&
    learningSteps
      .slice(docxReadEvictionIndex + 1)
      .some(
        (event) =>
          event.skillId === 'docx-read' &&
          (event.summary.includes('learning 已加载 docx-read') ||
            event.publicNarrative.includes('已学习 docx-read'))
      )
  return {
    learningSteps,
    evictionSummaries,
    hasEviction:
      evictionSummaries.length > 0 ||
      resultText.includes('evicted=') ||
      resultText.includes('已淘汰最早学习的 skill='),
    evictedDocxRead: docxReadEvictionIndex >= 0,
    relearnedDocxReadAfterEviction: docxReadRelearnAfterEviction
  }
}

const collectStartedToolNames = (events: readonly AiRunEvent[]): string[] =>
  filterAiRunEventsByType(events, 'tool_call_started').map((event) => String(event.toolName || ''))

const hasDocxReadEvidence = (toolNames: readonly string[]): boolean =>
  toolNames.some((name) => ['docx_read_outline', 'docx_search', 'docx_read_nodes'].includes(name))

const hasPdfReadEvidence = (toolNames: readonly string[]): boolean =>
  toolNames.some((name) => ['pdf_outline', 'pdf_search', 'pdf_read_pages'].includes(name))

const hasPptReadEvidence = (toolNames: readonly string[]): boolean =>
  toolNames.some((name) => ['ppt_read_outline', 'ppt_read_slides', 'ppt_search'].includes(name))

const hasExcelReadEvidence = (toolNames: readonly string[]): boolean =>
  toolNames.includes('excel_read')

describe('ai human live backend', () => {
  it('human-skill-eviction-relearn-loop-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-skill-eviction-relearn-loop-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description:
          '验证 live 下同一伙伴学满 active tool 上限后 FIFO 淘汰，续做仍能推进，需要时再自动学习被淘汰 skill；跨 run 首轮 brain 应明显复用上一 run 末次前缀缓存。',
        fixtures: [
          DOCX_READING_FIXTURE_PATHS[0],
          PDF_READING_FIXTURE_PATH,
          PPT_FIXTURE_PATH,
          EXCEL_FIXTURE_PATH
        ],
        runMode: 'single',
        runtimeModelName: loadLiveLlmConfigFromEnv().model_name,
        execute: async (runtime) => {
          await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv())
          const runnerOptions = { partnerId: PARTNER_ID }

          const run1Output = await (
            await createAiServiceTestRunner(runtime, {
              ...runnerOptions,
              userInput: RUN1_USER_INPUT,
              runId: `${runtime.runId}-run-1`
            })
          ).run()
          await assertRunFileReviews(runtime, run1Output)
          const run1Events = runtime.eventCollector.snapshot()
          const run1LlmIo = await runtime.eventCollector.snapshotLlmIo()
          const skillsAfterRun1 = readLatestLearnedSkillIds(
            await runtime.storageService.chatMessageLog.list(PARTNER_ID)
          )

          const run2Output = await (
            await createAiServiceTestRunner(runtime, {
              ...runnerOptions,
              userInput: RUN2_USER_INPUT,
              runId: `${runtime.runId}-run-2`
            })
          ).run()
          await assertRunFileReviews(runtime, run2Output)
          const afterRun2Events = runtime.eventCollector.snapshot()
          const afterRun2LlmIo = await runtime.eventCollector.snapshotLlmIo()
          const run2Events = afterRun2Events.slice(run1Events.length)
          const run2LlmIo = afterRun2LlmIo.filter(
            (record) => record.runId === `${runtime.runId}-run-2`
          )
          const skillsAfterRun2 = readLatestLearnedSkillIds(
            await runtime.storageService.chatMessageLog.list(PARTNER_ID)
          )
          const run2Eviction = collectLearningEvictionEvidence(run2Events)
          const run2PrefixCache = collectContinuationPrefixCacheReuse({
            previousRunId: `${runtime.runId}-run-1`,
            nextRunId: `${runtime.runId}-run-2`,
            previousLlmIo: run1LlmIo,
            nextLlmIo: run2LlmIo
          })
          // 若 Run2 已在同轮淘汰后又自动再学 docx-read，闭环已在 Run2 内完成，不必再开 Run3。
          const needRun3 =
            run2Eviction.evictedDocxRead && !run2Eviction.relearnedDocxReadAfterEviction

          const emptyRun3PrefixCache = null as ContinuationPrefixCacheReuse | null

          if (!run2Eviction.hasEviction || !run2Eviction.evictedDocxRead) {
            return {
              run1Output,
              run2Output,
              run3Output: undefined,
              skillsAfterRun1,
              skillsAfterRun2,
              skillsAfterRun3: skillsAfterRun2,
              run1Events,
              run2Events,
              run3Events: [] as AiRunEvent[],
              run2PrefixCache,
              run3PrefixCache: emptyRun3PrefixCache,
              memoExists: await fs
                .access(path.join(runtime.workspaceRoot, MEMO_NAME))
                .then(() => true)
                .catch(() => false),
              skippedRun3: true,
              closedLoopInRun2: false
            }
          }

          if (!needRun3) {
            return {
              run1Output,
              run2Output,
              run3Output: undefined,
              skillsAfterRun1,
              skillsAfterRun2,
              skillsAfterRun3: skillsAfterRun2,
              run1Events,
              run2Events,
              run3Events: [] as AiRunEvent[],
              run2PrefixCache,
              run3PrefixCache: emptyRun3PrefixCache,
              memoExists: await fs
                .access(path.join(runtime.workspaceRoot, MEMO_NAME))
                .then(() => true)
                .catch(() => false),
              skippedRun3: true,
              closedLoopInRun2: true
            }
          }

          const run3Output = await (
            await createAiServiceTestRunner(runtime, {
              ...runnerOptions,
              userInput: RUN3_USER_INPUT,
              runId: `${runtime.runId}-run-3`
            })
          ).run()
          await assertRunFileReviews(runtime, run3Output)
          const allEvents = runtime.eventCollector.snapshot()
          const allLlmIo = await runtime.eventCollector.snapshotLlmIo()
          const run3Events = allEvents.slice(afterRun2Events.length)
          const run3LlmIo = allLlmIo.filter((record) => record.runId === `${runtime.runId}-run-3`)
          const skillsAfterRun3 = readLatestLearnedSkillIds(
            await runtime.storageService.chatMessageLog.list(PARTNER_ID)
          )

          return {
            run1Output,
            run2Output,
            run3Output,
            skillsAfterRun1,
            skillsAfterRun2,
            skillsAfterRun3,
            run1Events,
            run2Events,
            run3Events,
            run2PrefixCache,
            run3PrefixCache: collectContinuationPrefixCacheReuse({
              previousRunId: `${runtime.runId}-run-2`,
              nextRunId: `${runtime.runId}-run-3`,
              previousLlmIo: run2LlmIo,
              nextLlmIo: run3LlmIo
            }),
            memoExists: await fs
              .access(path.join(runtime.workspaceRoot, MEMO_NAME))
              .then(() => true)
              .catch(() => false),
            skippedRun3: false,
            closedLoopInRun2: false
          }
        },
        assert: async (result, runtime) => {
          const run1Tools = collectStartedToolNames(result.run1Events)
          const run2Tools = collectStartedToolNames(result.run2Events)
          const run3Tools = collectStartedToolNames(result.run3Events)
          const run1Eviction = collectLearningEvictionEvidence(result.run1Events)
          const run2Eviction = collectLearningEvictionEvidence(result.run2Events)
          const run3Learning = collectLearningEvictionEvidence(result.run3Events)
          const run3RelearnedDocxRead =
            result.skillsAfterRun3.includes('docx-read') &&
            (run3Learning.learningSteps.some(
              (event) =>
                event.summary.includes('learning 已加载 docx-read') ||
                event.publicNarrative.includes('已学习 docx-read')
            ) ||
              JSON.stringify(
                filterAiRunEventsByType(result.run3Events, 'tool_call_result').filter(
                  (event) => event.toolName === 'learn_skill'
                )
              ).includes('docx-read'))

          runtime.assertThat(
            result.run1Output?.status === 'completed' &&
              !run1Eviction.hasEviction &&
              result.skillsAfterRun1.includes('docx-read') &&
              hasDocxReadEvidence(run1Tools) &&
              (hasPdfReadEvidence(run1Tools) ||
                hasPptReadEvidence(run1Tools) ||
                hasExcelReadEvidence(run1Tools)) &&
              result.skillsAfterRun1.length >= 2,
            {
              name: 'run1-fills-skills-without-eviction',
              message:
                'Run1 应先学到含 docx-read 在内的多项阅读技能并完成任务，且不应触发 FIFO 淘汰。',
              data: {
                status: result.run1Output?.status,
                skillsAfterRun1: result.skillsAfterRun1,
                run1Tools,
                run1Eviction
              }
            }
          )

          runtime.assertThat(
            result.run2Output?.status === 'completed' &&
              run2Eviction.evictedDocxRead &&
              (run2Tools.includes('docx_content_edit') ||
                run2Tools.includes('ppt_edit') ||
                result.memoExists),
            {
              name: 'run2-evicts-oldest-skill-and-continues',
              message: 'Run2 学新技能时应 FIFO 淘汰最早的 docx-read，并在淘汰后仍能完成写入续做。',
              data: {
                status: result.run2Output?.status,
                skillsAfterRun2: result.skillsAfterRun2,
                run2Tools,
                run2Eviction,
                memoExists: result.memoExists,
                skippedRun3: result.skippedRun3,
                closedLoopInRun2: result.closedLoopInRun2
              }
            }
          )

          runtime.assertThat(Boolean(result.run2PrefixCache?.satisfied), {
            name: 'run2-reuses-run1-prefix-cache',
            message:
              'Run2 首次 brain 的 cachedInputTokens 应明显复用 Run1 末次 brain 的 inputTokens 前缀；历史消息前缀和工具定义须一致，服务端缓存复用率须达到公用门槛；低命中按实际请求日志独立归因。',
            data: result.run2PrefixCache
              ? continuationPrefixCacheAssertionData(result.run2PrefixCache)
              : { run2PrefixCache: null }
          })

          if (result.closedLoopInRun2) {
            runtime.assertThat(
              run2Eviction.relearnedDocxReadAfterEviction && hasDocxReadEvidence(run2Tools),
              {
                name: 'run2-relearns-evicted-skill-in-same-run',
                message:
                  '若 Run2 同轮再次需要 Word 阅读，应在淘汰后自动再学 docx-read 并产生读工具证据。',
                data: {
                  skillsAfterRun2: result.skillsAfterRun2,
                  run2Tools,
                  run2Eviction
                }
              }
            )
            return
          }

          if (result.skippedRun3) {
            return
          }

          runtime.assertThat(
            result.run3Output?.status === 'completed' &&
              run3RelearnedDocxRead &&
              hasDocxReadEvidence(run3Tools),
            {
              name: 'run3-relearns-evicted-skill-and-finishes',
              message: 'Run3 在再次需要 Word 阅读时应自动再学 docx-read，并用它完成核对任务。',
              data: {
                status: result.run3Output?.status,
                skillsAfterRun3: result.skillsAfterRun3,
                run3Tools,
                run3Learning
              }
            }
          )

          runtime.assertThat(Boolean(result.run3PrefixCache?.satisfied), {
            name: 'run3-reuses-run2-prefix-cache',
            message:
              'Run3 首次 brain 的 cachedInputTokens 应明显复用 Run2 末次 brain 的 inputTokens 前缀；历史消息前缀和工具定义须一致，服务端缓存复用率须达到公用门槛；低命中按实际请求日志独立归因。',
            data: result.run3PrefixCache
              ? continuationPrefixCacheAssertionData(result.run3PrefixCache)
              : { run3PrefixCache: null }
          })
        }
      })
    })
  }, 1_800_000)
})
