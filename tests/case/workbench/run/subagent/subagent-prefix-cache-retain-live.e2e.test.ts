import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AiLlmIoRecord, AiRunEvent } from '../../../../../src/shared/types'
import {
  collectBrainPrefixCacheReuse,
  continuationPrefixCacheAssertionData
} from '../../../../harness/core/continuation-prefix-cache'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  clampWorkbenchPartnerName,
  collectWorkbenchLlmIoRecords,
  configureLiveModelThroughSettingsUi,
  createPartnerThroughWorkbenchUi,
  createTemporaryWorkbenchWorkspace,
  loadWorkbenchLiveModelEnv,
  prepareWorkbenchWorkspaceThroughUi,
  recordWorkbenchAiEvidence,
  selectWorkbenchModel,
  sendWorkbenchMessage,
  waitForWorkbenchAiRunCompletion
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'subagent-prefix-cache-retain-live'
const SOURCES = ['本周排期更新.txt', '对外口径确认.txt', '临时备注.txt']
const TASKS = [
  { directory: '排期核对', files: [SOURCES[0], SOURCES[1]] },
  { directory: '口径核对', files: [SOURCES[2], SOURCES[1]] }
]
const brainCalls = (records: readonly AiLlmIoRecord[], runId: string): AiLlmIoRecord[] =>
  records.filter(
    (record) =>
      record.runId === runId && record.caller === 'human.brain' && record.status === 'completed'
  )
const childUpdates = (events: readonly AiRunEvent[]) =>
  events.filter(
    (event): event is Extract<AiRunEvent, { type: 'subagent_updated' }> =>
      event.type === 'subagent_updated'
  )

describe('workbench subagent prefix cache e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'run',
        groups: ['subagent'],
        description: '真实 UI 一次派发，验证同一子实例连续调用及主派发收口的前缀和缓存',
        fixtures: SOURCES.map((name) => `tests/fixtures/workspace/工作/${name}`),
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const env = loadWorkbenchLiveModelEnv()
          const workspace = await createTemporaryWorkbenchWorkspace(CASE_ID, 'empty')
          const originals = new Map(
            await Promise.all(
              SOURCES.map(
                async (name) =>
                  [
                    name,
                    await fs.readFile(path.resolve('tests/fixtures/workspace/工作', name), 'utf8')
                  ] as const
              )
            )
          )
          const inputs: Array<{ sourcePath: string; original: string }> = []
          const taskFiles: string[][] = []
          for (const task of TASKS) {
            const directory = path.join(workspace.rootPath, task.directory)
            await fs.mkdir(directory)
            const files = task.files.map((name) => path.join(directory, name))
            for (const [index, name] of task.files.entries()) {
              const original = originals.get(name)!
              await fs.writeFile(files[index], original, 'utf8')
              inputs.push({ sourcePath: files[index], original })
            }
            taskFiles.push(files)
          }
          await configureLiveModelThroughSettingsUi(runtime.page, env)
          const workspaceName = clampWorkbenchPartnerName(`Workbench ${CASE_ID}`)
          await prepareWorkbenchWorkspaceThroughUi(runtime.page, {
            workspaceName,
            rootPath: workspace.rootPath
          })
          await createPartnerThroughWorkbenchUi(runtime.page, workspaceName)
          await selectWorkbenchModel(runtime.page, env.modelName)
          const tasks = [
            `先阅读 ${taskFiles[0][0]}，找出最终复核的时间安排；得到排期信息后，再阅读 ${taskFiles[0][1]} 核对正式负责人称呼。交付时间、负责人及两份来源路径。`,
            `先阅读 ${taskFiles[1][0]}，识别这份内部随手记对风险状态的判断；得到判断后，再阅读 ${taskFiles[1][1]} 核对能否用于对外同步。交付可用的风险口径、原因及两份来源路径。`
          ]
          const startedAt = Date.now()
          await sendWorkbenchMessage(
            runtime.page,
            `请通过 delegate_to_subagent 一次派发两位临时帮手，分别独立执行任务A：${tasks[0]} 任务B：${tasks[1]} 两位帮手只读自己的资料目录，不修改文件。你只简短汇总他们交付的负责人、排期和对外风险口径，不接管核对。`
          )
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAt,
            env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page: runtime.page }
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.8)
          const runId = evidence.events.find((event) => event.type === 'run_started')?.runId
          if (!runId) throw new Error('缺少主运行 ID')
          const records = await collectWorkbenchLlmIoRecords(runtime)
          const unchanged = await Promise.all(
            inputs.map(
              async (input) => (await fs.readFile(input.sourcePath, 'utf8')) === input.original
            )
          )
          await runtime.captureScreenshot({
            name: 'subagent-cache-completed',
            message: '一次派发的两项资料核对和主伙伴汇总'
          })
          return { runId, events: evidence.events, records, taskFiles, unchanged }
        },
        assert: async (result, runtime) => {
          expect(result.unchanged).toEqual([true, true, true, true])
          const assertCache = async (calls: AiLlmIoRecord[]): Promise<void> => {
            const pairs = calls.slice(1).map((next, index) =>
              collectBrainPrefixCacheReuse({
                previousLastBrain: calls[index],
                nextFirstBrain: next
              })
            )
            expect(pairs.length).toBeGreaterThan(0)
            for (const [index, reuse] of pairs.entries()) {
              await runtime.assertThat(reuse.prefixPreserved, {
                name: `request-prefix-${calls[0].runId}-${index + 1}`,
                message: '同一执行者的连续请求保留已有消息及工具前缀',
                data: continuationPrefixCacheAssertionData(reuse)
              })
              expect(Number.isFinite(reuse.reuseRatio)).toBe(true)
              expect(reuse.nextFirstCachedInputTokens).toBeGreaterThanOrEqual(0)
              expect(reuse.nextFirstCachedInputTokens!).toBeLessThanOrEqual(
                reuse.nextFirstInputTokens!
              )
            }
            await runtime.assertThat(
              pairs.some((reuse) => (reuse.nextFirstCachedInputTokens || 0) > 0),
              {
                name: `run-cache-reuse-${calls[0].runId}`,
                message: '同一执行者的连续请求实际复用缓存；逐段比例记录供评估',
                data: {
                  pairs: pairs.map(continuationPrefixCacheAssertionData)
                }
              }
            )
          }
          const updates = childUpdates(result.events)
          const completed = updates.filter((event) => event.update.status === 'completed')
          expect(completed).toHaveLength(2)
          const results: string[] = []
          for (const event of completed) {
            const childRunId = event.update.childRunId
            const calls = brainCalls(result.records, childRunId)
            expect(calls.length).toBeGreaterThanOrEqual(3)
            expect(
              calls.every(
                (call) =>
                  call.ownerRunId === result.runId &&
                  call.parentToolCallId === event.update.toolCallId
              )
            ).toBe(true)
            const reads = updates.filter(
              (item) =>
                item.update.childRunId === childRunId &&
                item.update.action?.toolName === 'text_file_read' &&
                item.update.action.status === 'completed'
            )
            expect(reads.length).toBeGreaterThanOrEqual(2)
            const toolMessages = JSON.stringify(
              calls.flatMap(
                (call) =>
                  call.requestWire?.messages.filter((message) => message.role === 'tool') || []
              )
            )
            const files = result.taskFiles.find((sources) => toolMessages.includes(sources[0]))
            expect(files).toBeDefined()
            for (const file of files!) expect(toolMessages).toContain(file)
            expect(toolMessages).toContain('Alice')
            expect(toolMessages).toContain('保持跟进')
            results.push(event.update.result || '')
            await assertCache(calls)
          }
          expect(results.join('\n')).toContain('Alice')
          expect(results.join('\n')).toMatch(/跟进|签署/)
          const root = brainCalls(result.records, result.runId)
          expect(root.length).toBeGreaterThanOrEqual(2)
          await assertCache(root)
          expect(root.at(-1)?.rawText).toContain('Alice')
          expect(root.at(-1)?.rawText).toMatch(/跟进|签署/)
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
