import http from 'node:http'
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
  selectWorkbenchExecutionPermission,
  collectWorkbenchAiRunEvents,
  waitForWorkbenchAiEvent,
  sendWorkbenchMessage,
  waitForWorkbenchAiRunCompletion
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'subagent-prefix-cache-retain-live'
const SOURCES = ['本周排期更新.txt', '对外口径确认.txt', '临时备注.txt', '财务与付款材料跟进.txt']
const TASKS = [
  { directory: '排期核对', files: [SOURCES[0], SOURCES[1], SOURCES[3]] },
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
        description: '真实 UI 中断并续接同一子会话，验证首次续接的请求前缀与实际缓存',
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
            `先阅读 ${taskFiles[0][0]}，找出最终复核的时间安排；得到排期信息后，再阅读 ${taskFiles[0][1]} 核对正式负责人称呼；最后阅读 ${taskFiles[0][2]}，核对财务执行人的动作、时限与主负责人区别。交付时间、主负责人、财务后续动作及三份来源路径。`,
            `先阅读 ${taskFiles[1][0]}，识别这份内部随手记对风险状态的判断；得到判断后，再阅读 ${taskFiles[1][1]} 核对能否用于对外同步。交付可用的风险口径、原因及两份来源路径。`
          ]
          await selectWorkbenchExecutionPermission(runtime.page, '完全访问')
          let requested = false
          let ready = false
          const server = http.createServer((_request, response) => {
            requested = true
            if (ready)
              response.end('<html><body>复核资料页已就绪，可以交付之前核对的结果。</body></html>')
          })
          await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
          const address = server.address()
          if (!address || typeof address === 'string') throw new Error('资料服务未启动')
          const url = `http://127.0.0.1:${address.port}/review`
          runtime.registerResource({
            name: 'cache-resume-input-site',
            phase: 'before-app-close',
            dispose: async () => {
              server.closeAllConnections()
              await new Promise<void>((resolve) => server.close(() => resolve()))
            }
          })
          const startedAt = Date.now()
          await sendWorkbenchMessage(
            runtime.page,
            `请通过 delegate_to_subagent 一次派发两位帮手，分别独立执行任务A：${tasks[0]} 核对三份资料后，再使用 browser_use 打开 ${url}，页面加载完成后才能交付。任务B：${tasks[1]} 两位帮手只读自己的资料，不修改文件。你只简短汇总，不接管核对。`
          )
          await waitForWorkbenchAiEvent(runtime, {
            name: 'other-child-completed',
            matches: (event) =>
              event.type === 'subagent_updated' &&
              event.createdAt >= startedAt &&
              event.update.status === 'completed'
          })
          const deadline = Date.now() + WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
          while (!requested) {
            if (Date.now() > deadline) throw new Error('子任务没有读取资料并打开待加载页')
            await runtime.page.waitForTimeout(250)
          }
          const beforeEvents = (await collectWorkbenchAiRunEvents(runtime)).filter(
            (event) => event.createdAt >= startedAt
          )
          const pending = childUpdates(beforeEvents)
            .filter(
              (event) =>
                event.update.status === 'running' && event.update.action?.toolName === 'browser_use'
            )
            .at(-1)
          if (!pending) throw new Error('缺少待加载子任务执行证据')
          await runtime.page.getByRole('button', { name: '停止本次运行', exact: true }).click()
          await waitForWorkbenchAiEvent(runtime, {
            name: 'root-stopped',
            matches: (event) => event.type === 'run_cancelled' && event.runId === pending.runId
          })
          await runtime.page
            .getByRole('button', { name: '停止本次运行', exact: true })
            .waitFor({ state: 'hidden' })
          const interruptedEvents = (await collectWorkbenchAiRunEvents(runtime)).filter(
            (event) => event.createdAt >= startedAt
          )
          ready = true
          const resumeStartedAt = Date.now()
          await sendWorkbenchMessage(
            runtime.page,
            '继续刚才未完成的子任务。先查询现有子 agent，续接原会话；资料页现在已就绪。利用它已读取的资料完成交付，不新建替代子 agent。'
          )
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            resumeStartedAt,
            env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page: runtime.page }
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.8)
          const runId = evidence.events.find((event) => event.type === 'run_started')?.runId
          if (!runId) throw new Error('缺少续接主运行 ID')
          const records = await collectWorkbenchLlmIoRecords(runtime)
          const events = [
            ...interruptedEvents,
            ...evidence.events.filter((event) => event.createdAt >= resumeStartedAt)
          ]
          const resumed = childUpdates(events).find(
            (event) =>
              event.runId === runId &&
              event.update.agentId === pending.update.agentId &&
              event.update.status === 'completed'
          )
          if (!resumed || resumed.update.childRunId === pending.update.childRunId)
            throw new Error('未续接同一子会话的新执行')
          const previous = brainCalls(records, pending.update.childRunId).at(-1)
          const first = brainCalls(records, pending.update.childRunId)[0]
          const next = brainCalls(records, resumed.update.childRunId)[0]
          const resumeCache = collectBrainPrefixCacheReuse({
            previousLastBrain: previous,
            nextFirstBrain: next
          })
          await runtime.assertThat(
            resumeCache.prefixPreserved &&
              (first?.usage?.inputTokens || 0) > 0 &&
              (resumeCache.nextFirstCachedInputTokens || 0) > first.usage!.inputTokens!,
            {
              name: 'same-agent-resume-cache',
              message: '同子会话续接保留前缀，真实缓存复用超过首次请求规模并覆盖新增历史',
              data: {
                agentId: pending.update.agentId,
                firstCallId: first.callId,
                firstInputTokens: first.usage?.inputTokens,
                ...continuationPrefixCacheAssertionData(resumeCache)
              }
            }
          )
          const unchanged = await Promise.all(
            inputs.map(
              async (input) => (await fs.readFile(input.sourcePath, 'utf8')) === input.original
            )
          )
          await runtime.captureScreenshot({
            name: 'subagent-cache-completed',
            message: '一次派发的两项资料核对和主伙伴汇总'
          })
          return { runId, events, records, taskFiles, unchanged }
        },
        assert: async (result, runtime) => {
          expect(result.unchanged).toEqual(result.taskFiles.flat().map(() => true))
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
            const calls = result.records.filter(
              (record) =>
                record.agentId === event.update.agentId &&
                record.caller === 'human.brain' &&
                record.status === 'completed'
            )
            expect(
              calls.every((call) =>
                Boolean(call.ownerRunId && call.parentToolCallId && call.agentId)
              )
            ).toBe(true)
            const reads = updates.filter(
              (item) =>
                item.update.agentId === event.update.agentId &&
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
            const files = result.taskFiles.find(
              (sources) =>
                toolMessages.includes(sources[0]) ||
                toolMessages.includes(
                  `${path.basename(path.dirname(sources[0]))}/${path.basename(sources[0])}`
                )
            )
            expect(files).toBeDefined()
            for (const file of files!) {
              const relativePath = `${path.basename(path.dirname(file))}/${path.basename(file)}`
              expect(toolMessages.includes(file) || toolMessages.includes(relativePath)).toBe(true)
              const original = await fs.readFile(
                path.resolve('tests/fixtures/workspace/工作', path.basename(file)),
                'utf8'
              )
              for (const line of original.split(/\r?\n/u).filter(Boolean).slice(0, 2)) {
                expect(toolMessages).toContain(line)
              }
              expect(
                event.update.result?.includes(file) || event.update.result?.includes(relativePath)
              ).toBe(true)
            }
            expect(toolMessages).toContain('Alice')
            expect(toolMessages).toContain('保持跟进')
            results.push(event.update.result || '')
            await assertCache(calls)
          }
          expect(results.join('\n')).toContain('Alice')
          expect(results.join('\n')).toContain('Bob')
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
