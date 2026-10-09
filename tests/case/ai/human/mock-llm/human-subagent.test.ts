import { readReviewPart, storyText } from '../../../../harness/backend/docxReviewAssertions'
import fs from 'node:fs/promises'
import path from 'node:path'
import mammoth from 'mammoth'
import { createAiRunContext } from '../../../../../src/main/services/ai/runtime'
import { createContextCompactionNode } from '../../../../../src/main/services/ai/human/node/contextCompactionNode'
import { createHumanRuntimeCache } from '../../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../../src/main/services/ai/human/state/schema'
import { describe, it, expect } from 'vitest'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  createAiServiceTestRunner,
  createChatServiceTestRunner
} from '../../../../harness/backend/aiServiceHarness'
import type { ScriptedLlmCall, ScriptedLlmStep } from '../../../../harness/backend/test-types'
import {
  buildCompleteTaskDecision,
  buildToolDecision,
  buildLearnSkillsDecision,
  collectTerminalReviewCommandIds
} from '../testUtils'
import {
  projectMessageLogRecords,
  repairInterruptedToolCalls
} from '../../../../../src/main/services/ai/human/memory/transcript'
import { messagesFromLogEntries } from '../../../../../src/main/services/ai/human/memory/conversationLogMessages'
import { createMemoryTranscript } from '../../../../../src/main/services/ai/run/subagents'
import { collectBrainPrefixCacheReuse } from '../../../../harness/core/continuation-prefix-cache'
import { AiFileChangeService } from '../../../../../src/main/services/ai/fileChanges/AiFileChangeService'
import { terminalSessionManager } from '../../../../../src/main/services/ai/human/tools/terminal/TerminalSessionManager'
import type { ChatMessageLogEntry, SubagentUpdate } from '../../../../../src/shared/types'

const complete = (text: string) => buildCompleteTaskDecision({ summary: text })
const delegate = (tasks: Array<{ name: string; task: string }>) =>
  buildToolDecision({
    toolName: 'delegate_to_subagent',
    args: { tasks },
    summary: '并行处理独立任务'
  })
const steps = (
  execute: (
    call: ScriptedLlmCall
  ) => ReturnType<typeof complete> | Promise<ReturnType<typeof complete>>
): ScriptedLlmStep[] => Array.from({ length: 30 }, () => execute)
const isChild = (call: ScriptedLlmCall): boolean => /用户诉求：\n(?:CHILD_|PHASE_)/.test(call.user)

describe('temporary subagents through production AiRunService', () => {
  it('human-subagent-approval', async () => {
    await runBackendCase({
      caseId: 'human-subagent-approval',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      harnessMode: 'mock-llm',
      fixtures: [],
      runMode: 'single',
      description: '生产提交、同实例审批续跑、FIFO、拒绝指导和取消清理',
      execute: async (runtime) => {
        const waitFor = async (check: () => boolean | Promise<boolean>) => {
          const deadline = Date.now() + 90000
          while (!(await check())) {
            if (Date.now() > deadline) throw new Error('approval evidence timed out')
            await new Promise<void>((resolve) => setTimeout(resolve, 20))
          }
        }
        const exists = async (target: string) =>
          fs.stat(target).then(
            () => true,
            () => false
          )
        const results: Array<{
          mode: string
          status?: string
          approvals: number
          reviewCalls: number
          executed: boolean
        }> = []
        for (const mode of [
          'approve',
          'reject',
          'guide',
          'auto',
          'rule',
          'review_error',
          'full_access'
        ]) {
          const target = path.join(runtime.workspaceRoot, mode)
          let rootCalls = 0
          let childCalls = 0
          const childInputs: string[] = []
          const runner = await createChatServiceTestRunner(runtime, {
            partnerId: `approval-${mode}`,
            userInput: 'PARENT_SECRET 独立完成任务',
            executionPermission: mode === 'full_access' ? 'full_access' : 'review',
            llmScript: {
              'human.brain': steps((call) => {
                if (!isChild(call))
                  return ++rootCalls === 1
                    ? delegate([
                        { name: '公式海豹', task: `CHILD_${mode.toUpperCase()} 独立创建核对目录` }
                      ])
                    : complete('收到独立任务结果')
                childInputs.push(call.user)
                childCalls += 1
                return childCalls === 1
                  ? buildToolDecision({
                      toolName: 'terminal_run',
                      args: {
                        command:
                          mode === 'rule'
                            ? process.platform === 'win32'
                              ? 'Get-Location'
                              : 'pwd'
                            : `mkdir "${target}"`,
                        commandExplanation: '创建核对目录'
                      },
                      summary: '创建任务结果目录'
                    })
                  : complete('RESULT 独立任务处理完成')
              }),
              'human.terminal_review': Array.from({ length: 8 }, () => (call: ScriptedLlmCall) => {
                if (mode === 'review_error') throw new Error('review provider unavailable')
                return {
                  decisions: collectTerminalReviewCommandIds(call.user).map((commandId) => ({
                    commandId,
                    decision: mode === 'auto' ? 'auto_approve' : 'needs_human_review',
                    reason: '授权范围待确认'
                  }))
                }
              })
            }
          })
          const run = await runner.submit()
          try {
            const manual = ['approve', 'reject', 'guide', 'review_error'].includes(mode)
            if (manual) {
              await waitFor(() =>
                runner.events.some((event) => event.type === 'approval_batch_required')
              )
              const request = runner.events.find(
                (event) => event.type === 'approval_batch_required'
              )!
              if (request.type !== 'approval_batch_required') throw new Error('missing approval')
              expect(await exists(target)).toBe(false)
              expect(request.runId).toBe(run.runId)
              expect(request.source?.name).toBe('公式海豹')
              const childId = request.source!.childRunId
              expect(
                runner.events.some(
                  (event) =>
                    event.type === 'subagent_updated' &&
                    event.update.childRunId === childId &&
                    event.update.status === 'waiting_approval'
                )
              ).toBe(true)
              const action = mode === 'reject' ? 'reject' : mode === 'guide' ? 'guide' : 'approve'
              expect(
                (
                  await runner.service.decideApprovalBatch({
                    runId: run.runId,
                    batchId: request.batchId,
                    decisions: request.items.map((item) => ({
                      itemId: item.itemId,
                      action,
                      message: action === 'guide' ? '不要创建目录，仅报告现状' : undefined
                    }))
                  })
                ).success
              ).toBe(true)
              await run.wait()
              expect(
                runner.events.some(
                  (event) =>
                    event.type === 'subagent_updated' &&
                    event.update.childRunId === childId &&
                    event.update.status === 'completed'
                )
              ).toBe(true)
              if (action === 'guide')
                expect(childInputs.at(-1)).toContain('不要创建目录，仅报告现状')
              if (action === 'reject') expect(childInputs.at(-1)).toMatch(/拒绝|reject/)
              const logs = await runtime.storageService.chatMessageLog.listByRun(run.runId)
              expect(
                logs.find(
                  (record) =>
                    record.entry.kind === 'annotation' &&
                    record.entry.eventType === 'approval_decided'
                )?.entry
              ).toMatchObject({ payload: { source: { childRunId: childId } } })
              expect(
                (
                  await runner.service.decideApprovalBatch({
                    runId: run.runId,
                    batchId: request.batchId,
                    decisions: request.items.map((item) => ({
                      itemId: item.itemId,
                      action: 'approve'
                    }))
                  })
                ).success
              ).toBe(false)
            }
            const stored = await run.wait()
            expect(childInputs.every((input) => !input.includes('PARENT_SECRET'))).toBe(true)
            for (const record of runner.io.filter(
              (item) => item.caller === 'human.terminal_review'
            )) {
              expect(record.user).toContain(`CHILD_${mode.toUpperCase()} 独立创建核对目录`)
              expect(record.user).not.toContain('PARENT_SECRET')
            }
            const executed = await exists(target)
            expect(executed).toBe(!['reject', 'guide', 'rule'].includes(mode))
            const actions = runner.events.filter(
              (event) =>
                event.type === 'subagent_updated' &&
                event.update.action?.toolName === 'terminal_run' &&
                event.update.action.status === 'completed'
            )
            expect(actions).toHaveLength(['reject', 'guide'].includes(mode) ? 0 : 1)
            const approvals = runner.events.filter(
              (event) => event.type === 'approval_batch_required'
            ).length
            const reviewCalls = runner.io.filter(
              (record) => record.caller === 'human.terminal_review' && record.status === 'completed'
            ).length
            if (!manual) expect(approvals).toBe(0)
            if (mode === 'rule' || mode === 'full_access') expect(reviewCalls).toBe(0)
            results.push({ mode, status: stored?.status, executed, approvals, reviewCalls })
          } finally {
            await runner.service.cancelRun(run.runId)
            await run.wait()
          }
        }

        // Two retained executors fill the quota. A third starts after a user decision.
        const targets = ['FIRST', 'SECOND', 'THIRD'].map((name) => ({
          name,
          path: path.join(runtime.workspaceRoot, name)
        }))
        let rootCalls = 0
        const childCalls = new Map<string, number>()
        const baseline = path.join(runtime.workspaceRoot, 'before-stop.txt')
        await fs.writeFile(baseline, 'original protected')
        const runner = await createChatServiceTestRunner(runtime, {
          partnerId: 'approval-fifo',
          userInput: '三项独立核对',
          executionPermission: 'review',
          llmScript: {
            'human.brain': steps((call) => {
              if (!isChild(call))
                return ++rootCalls === 1
                  ? delegate(targets.map(({ name }) => ({ name, task: `CHILD_${name} 核对` })))
                  : complete('结果汇总')
              const name = call.user.match(/用户诉求：\nCHILD_([A-Z]+)/)![1]
              const count = (childCalls.get(name) || 0) + 1
              childCalls.set(name, count)
              if (name === 'FIRST' && count === 1)
                return buildToolDecision({
                  toolName: 'text_file_edit',
                  args: {
                    action: 'edit',
                    sourcePath: baseline,
                    edits: [{ oldText: 'original', newText: 'saved' }]
                  },
                  summary: '保存已有修改'
                })
              if (count === (name === 'FIRST' ? 2 : 1))
                return buildToolDecision({
                  toolName: 'terminal_run',
                  args: {
                    command: `mkdir "${targets.find((item) => item.name === name)!.path}"`,
                    commandExplanation: '创建核对结果目录'
                  },
                  summary: '准备核对目录'
                })
              return complete(`RESULT_${name}`)
            }),
            'human.terminal_review': Array.from({ length: 8 }, () => (call: ScriptedLlmCall) => ({
              decisions: collectTerminalReviewCommandIds(call.user).map((commandId) => ({
                commandId,
                decision: 'needs_human_review',
                reason: '等待授权'
              }))
            }))
          }
        })
        const run = await runner.submit()
        try {
          await waitFor(
            async () =>
              (await runtime.storageService.chatMessageLog.listByRun(run.runId)).filter(
                (record) =>
                  record.entry.kind === 'annotation' &&
                  record.entry.eventType === 'approval_requested'
              ).length === 2
          )
          expect(childCalls.has('THIRD')).toBe(false)
          expect(
            runner.events.filter((event) => event.type === 'approval_batch_required')
          ).toHaveLength(1)
          const current = (await runtime.storageService.aiRun.getRun(run.runId))!.pendingApproval!
          expect(
            await exists(targets.find((item) => item.name === current.source!.name)!.path)
          ).toBe(false)
          expect(
            (
              await runner.service.decideApprovalBatch({
                runId: run.runId,
                batchId: current.batchId,
                decisions: current.items.map((item) => ({ itemId: item.itemId, action: 'approve' }))
              })
            ).success
          ).toBe(true)
          await waitFor(
            async () =>
              childCalls.has('THIRD') &&
              (await runtime.storageService.chatMessageLog.listByRun(run.runId)).filter(
                (record) =>
                  record.entry.kind === 'annotation' &&
                  record.entry.eventType === 'approval_requested'
              ).length === 3
          )
          const pending = (await runtime.storageService.aiRun.getRun(run.runId))!.pendingApproval!
          expect(pending.source!.childRunId).not.toBe(current.source!.childRunId)
          const snapshot = await runner.service.getPartnerSnapshot(runner.partnerId)
          expect(snapshot.activeRuns[0].pendingApproval?.source).toEqual(pending.source)
          const records = await runtime.storageService.chatMessageLog.listByRun(run.runId)
          const repaired = repairInterruptedToolCalls(
            messagesFromLogEntries(records.map((record) => record.entry)),
            records
          )
          expect(
            repaired
              .filter((message) => message.getType() === 'tool')
              .map((message) => message.content)
              .join(' ')
          ).toContain('interrupted')
          await runner.service.cancelRun(run.runId)
          const stored = await run.wait()
          expect(stored?.status).toBe('cancelled')
          expect(stored?.pendingApproval).toBeUndefined()
          expect(
            (
              await runner.service.decideApprovalBatch({
                runId: run.runId,
                batchId: pending.batchId,
                decisions: pending.items.map((item) => ({ itemId: item.itemId, action: 'approve' }))
              })
            ).success
          ).toBe(false)
          expect(await fs.readFile(baseline, 'utf8')).toBe('saved protected')
          const changes = (
            await runtime.storageService.aiFileChange.listRecords({ runId: run.runId })
          ).items
          expect(changes).toHaveLength(1)
          expect(changes[0]).toMatchObject({ runId: run.runId, partnerId: runner.partnerId })
          expect(
            await exists(targets.find((item) => item.name === pending.source!.name)!.path)
          ).toBe(false)
          expect(
            runner.events.filter(
              (event) => event.type === 'subagent_updated' && event.update.status === 'cancelled'
            )
          ).toHaveLength(2)
          expect(
            (await runtime.storageService.chatMessageLog.listByRun(run.runId)).filter(
              (record) =>
                record.entry.kind === 'annotation' &&
                record.entry.eventType === 'approval_cancelled'
            )
          ).toHaveLength(2)
        } finally {
          await runner.service.cancelRun(run.runId)
          await run.wait()
        }
        return { results, events: runner.events }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.results.every((item) => item.status === 'completed'),
          {
            name: 'approval-public-execution-chain',
            message: '允许拒绝指导与自动放行均完成原子任务',
            data: result.results
          }
        )
      }
    })
  })

  it('human-subagent-isolation', async () => {
    await runBackendCase({
      caseId: 'human-subagent-isolation',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      harnessMode: 'mock-llm',
      fixtures: [],
      runMode: 'single',
      description: '独立上下文、并行派发及统一结果投递',
      execute: async (runtime) => {
        const inputs: string[] = []
        let parentCalls = 0
        let active = 0
        let peak = 0
        const started = new Set<string>()
        let releaseChildren: () => void = () => {}
        const bothStarted = new Promise<void>((resolve) => {
          releaseChildren = resolve
        })
        const runner = await createAiServiceTestRunner(runtime, {
          userInput: 'PARENT_SECRET 只存在主聊天',
          abortSignal: new AbortController().signal,
          llmScript: {
            'human.brain': steps(async (call) => {
              if (!isChild(call))
                return ++parentCalls === 1
                  ? delegate([
                      { name: '海豹', task: 'CHILD_ALPHA 独立查验 A' },
                      { name: '水獭', task: 'CHILD_BETA 独立查验 B' },
                      { name: '松鼠', task: 'CHILD_GAMMA 独立查验 C' },
                      { name: '狐狸', task: 'CHILD_DELTA 独立查验 D' },
                      ...Array.from({ length: 8 }, (_, index) => ({
                        name: `飞鸟${index + 1}`,
                        task: `CHILD_EXTRA_${index + 1} 独立查验`
                      }))
                    ])
                  : complete('主伙伴汇集完成')
              inputs.push(call.user)
              const task = call.user.match(/CHILD_([A-Z_0-9]+)/)?.[1] || ''
              active += 1
              peak = Math.max(peak, active)
              started.add(task)
              if (started.size === 2) releaseChildren()
              await bothStarted
              active -= 1
              return complete(`RESULT_${task} 核对完成`)
            })
          }
        })
        const output = await runner.run()
        const records = await runtime.storageService.chatMessageLog.list(runner.payload.partnerId)
        return {
          output,
          records,
          inputs,
          peak,
          events: runner.events.slice(),
          io: runner.io.slice()
        }
      },
      assert: async (result, runtime) => {
        expect(result.output.status).toBe('completed')
        expect(result.inputs).toHaveLength(12)
        expect(result.peak).toBe(2)
        expect(result.inputs.every((input) => !input.includes('PARENT_SECRET'))).toBe(true)
        const terminal = result.records.filter(
          (record) =>
            record.entry.kind === 'annotation' &&
            record.entry.eventType === 'subagent_updated' &&
            record.entry.payload.status === 'completed'
        )
        expect(terminal).toHaveLength(12)
        expect(result.records.every((record) => record.runId === runtime.runId)).toBe(true)
        expect(
          result.records.filter(
            (record) => record.entry.kind === 'assistant' && record.entry.toolCalls.length === 0
          )
        ).toHaveLength(1)
        expect(result.events.filter((event) => event.type === 'answer_completed')).toHaveLength(1)
        expect(result.io.filter((record) => record.ownerRunId === runtime.runId)).toHaveLength(12)
        const started = result.events.filter(
          (event) =>
            event.type === 'subagent_updated' &&
            event.update.status === 'running' &&
            !event.update.action &&
            !event.update.message
        )
        expect(
          started.map((event) => (event.type === 'subagent_updated' ? event.update.name : ''))
        ).toEqual([
          '海豹',
          '水獭',
          '松鼠',
          '狐狸',
          ...Array.from({ length: 8 }, (_, index) => `飞鸟${index + 1}`)
        ])
        const released = result.events.findIndex(
          (event) => event.type === 'subagent_updated' && event.update.status === 'completed'
        )
        const third = result.events.findIndex(
          (event) =>
            event.type === 'subagent_updated' &&
            event.update.status === 'running' &&
            event.update.name === '松鼠'
        )
        expect(third).toBeGreaterThan(released)
        const streams = result.events.filter((event) => event.type === 'subagent_stream')
        for (const ended of terminal) {
          if (ended.entry.kind !== 'annotation' || ended.entry.eventType !== 'subagent_updated')
            continue
          const own = streams.filter((event) => event.childRunId === ended.entry.payload.childRunId)
          expect(
            own
              .filter((event) => event.delta)
              .map((event) => event.delta)
              .join('')
          ).toBe(ended.entry.payload.result)
          expect(own.some((event) => event.streaming === true)).toBe(true)
          expect(own.at(-1)?.streaming).toBe(false)
        }
        expect(
          result.records.filter(
            (record) =>
              record.entry.kind === 'annotation' &&
              record.entry.eventType === 'subagent_updated' &&
              record.entry.payload.status === 'queued'
          )
        ).toHaveLength(12)
        runtime.assertThat(
          result.records.some(
            (record) =>
              record.entry.kind === 'tool' &&
              record.entry.toolName === 'delegate_to_subagent' &&
              record.entry.content.includes('RESULT_ALPHA') &&
              record.entry.content.includes('RESULT_BETA') &&
              record.entry.content.includes('RESULT_GAMMA') &&
              record.entry.content.includes('RESULT_DELTA')
          ),
          {
            name: 'aggregate-result',
            message: '子结果汇入一条主工具结果，子完整 transcript 不落盘'
          }
        )
      }
    })
  })

  it('human-subagent-prefix-stability', async () => {
    await runBackendCase({
      caseId: 'human-subagent-prefix-stability',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      harnessMode: 'mock-llm',
      fixtures: [],
      runMode: 'single',
      description: '真实子内存投影连续追加与新实例固定前缀',
      execute: async (runtime) => {
        const files = ['A', 'B'].map((suffix) =>
          path.join(runtime.workspaceRoot, `cache-note-${suffix}.txt`)
        )
        for (const file of files) await fs.writeFile(file, '固定资料：苍鹭；负责人：林可。')
        let parentCalls = 0
        const calls = new Map<string, number>()
        const runner = await createAiServiceTestRunner(runtime, {
          userInput: 'ROOT_CACHE 派发两轮独立核验并汇总',
          streamingModeOverride: 'force_stream',
          llmScript: {
            'human.brain': steps((call) => {
              if (!isChild(call)) {
                return ++parentCalls <= 2
                  ? delegate([
                      { name: '海豹', task: `CHILD_CACHE_A 核验 ${files[0]}` },
                      { name: '水獭', task: `CHILD_CACHE_B 核验 ${files[1]}` }
                    ])
                  : complete('主伙伴只整合独立结果')
              }
              const task = call.user.match(/CHILD_CACHE_[AB]/)?.[0] || ''
              const count = (calls.get(task) || 0) + 1
              calls.set(task, count)
              return count % 3 === 0
                ? complete(`PUBLIC_RESULT_${task}`)
                : buildToolDecision({
                    toolName: 'text_file_read',
                    args: { sourcePath: files[task.endsWith('A') ? 0 : 1] },
                    summary: `PUBLIC_ACTION_${task}_${count}`
                  })
            })
          }
        })
        const output = await runner.run()
        return { output, io: runner.io, events: runner.events }
      },
      assert: async (result, runtime) => {
        expect(result.output.status).toBe('completed')
        const brain = result.io.filter((record) => record.caller === 'human.brain')
        const root = brain.filter((record) => !record.ownerRunId)
        const children = [
          ...new Set(brain.filter((record) => record.ownerRunId).map((record) => record.runId))
        ]
        expect(root).toHaveLength(3)
        expect(children).toHaveLength(4)
        const firstCalls = children.map((id) => brain.find((record) => record.runId === id)!)
        for (const first of firstCalls) {
          expect(first.system).toBe(firstCalls[0].system)
          expect(first.requestWire?.toolsHash).toBe(firstCalls[0].requestWire?.toolsHash)
          expect(first.requestWire?.messages).toHaveLength(2)
          expect(first.user).not.toContain('PUBLIC_RESULT_')
          expect(first.user).not.toContain('PUBLIC_ACTION_')
        }
        for (const runId of [runtime.runId, ...children]) {
          const records = brain.filter((record) => record.runId === runId)
          expect(records).toHaveLength(3)
          for (let index = 1; index < records.length; index += 1) {
            const reuse = collectBrainPrefixCacheReuse({
              previousLastBrain: records[index - 1],
              nextFirstBrain: records[index]
            })
            expect(reuse.prefixPreserved, JSON.stringify(reuse.requestWireDiff)).toBe(true)
          }
        }
        expect(root.some((record) => record.user.includes('PUBLIC_ACTION_'))).toBe(false)
        for (const childRunId of children) {
          const own = result.events.filter(
            (event) => event.type === 'subagent_stream' && event.childRunId === childRunId
          )
          expect(own.filter((event) => event.delta && event.reset && event.streaming)).toHaveLength(
            3
          )
          expect(own.at(-1)?.streaming).toBe(false)
        }
        runtime.assertThat(true, {
          name: 'subagent-prefix-stable',
          message: '主子真实消息前缀保留，新实例不继承旧子历史；mock 不伪造服务端缓存'
        })
      }
    })
  })

  it('human-subagent-file-cancellation', async () => {
    await runBackendCase({
      caseId: 'human-subagent-file-cancellation',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      harnessMode: 'mock-llm',
      fixtures: ['tests/fixtures/workspace/sample-edit.docx'],
      runMode: 'single',
      description: '文件统一基线与取消后保留修改',
      execute: async (runtime) => {
        const file = path.join(runtime.workspaceRoot, 'handoff.txt')
        await fs.writeFile(file, 'first baseline\nprotected\n')
        const docx = runtime.getFixtureWorkspacePath('tests/fixtures/workspace/sample-edit.docx')
        const docxBefore = await fs.readFile(docx)
        const controller = new AbortController()
        let parentCall = 0
        const childCalls = new Map<string, number>()
        const runner = await createAiServiceTestRunner(runtime, {
          userInput: '两次独立修改后等待取消',
          abortSignal: controller.signal,
          llmScript: {
            'human.brain': steps(async (call) => {
              if (!isChild(call)) {
                const parentStep = ++parentCall
                if (parentStep === 1)
                  return buildLearnSkillsDecision({ skillIds: ['docx-read'], summary: '查看文档' })
                if (parentStep === 2)
                  return buildToolDecision({
                    toolName: 'docx_search',
                    args: { sourcePath: docx, query: 'Hello from fixture' },
                    summary: '主伙伴先读文档'
                  })
                if (parentStep === 3)
                  return buildToolDecision({
                    toolName: 'text_file_read',
                    args: { sourcePath: file },
                    summary: '主伙伴先读文本'
                  })
                const phase = parentStep - 3
                return delegate(
                  phase === 3
                    ? [
                        { name: '海豹3', task: `PHASE_3 等待取消 ${file}` },
                        { name: '水獭3', task: `PHASE_3 等待取消 ${file}` },
                        { name: '排队狐狸', task: 'PHASE_QUEUED 不应该开始' }
                      ]
                    : [{ name: `海豹${phase}`, task: `PHASE_${phase} 修改 ${file}` }]
                )
              }
              const phase = call.user.match(/PHASE_(\d)/)?.[1] || '1'
              const count = (childCalls.get(phase) || 0) + 1
              childCalls.set(phase, count)
              if (phase === '3') {
                controller.abort()
                return complete('等待取消')
              }
              if (count === 2)
                return buildLearnSkillsDecision({
                  skillIds: ['docx-read', 'docx-write'],
                  summary: '文档编辑'
                })
              if (count === 3)
                return buildToolDecision({
                  toolName: 'docx_search',
                  args: {
                    sourcePath: docx,
                    query: phase === '1' ? 'Hello from fixture' : 'Intermediate docx'
                  },
                  summary: '定位文档'
                })
              if (count === 4) {
                const nodeId = [...call.user.matchAll(/nodeId=([^;\s]+)/g)].at(-1)?.[1]
                if (!nodeId) throw new Error('真实 DOCX 读取未返回节点')
                return buildToolDecision({
                  toolName: 'docx_content_edit',
                  args: {
                    sourcePath: docx,
                    type: 'replace_text',
                    nodeId,
                    oldText: phase === '1' ? 'Hello from fixture' : 'Intermediate docx',
                    newText: phase === '1' ? 'Intermediate docx' : 'Final docx'
                  },
                  summary: '修改文档'
                })
              }
              if (count === 5)
                return buildToolDecision({
                  toolName: 'terminal_run',
                  args: { command: 'pwd', commandExplanation: '确认子终端工作区' },
                  summary: '子终端'
                })
              return count === 1
                ? buildToolDecision({
                    toolName: 'text_file_edit',
                    args: {
                      action: 'edit',
                      sourcePath: file,
                      edits: [
                        {
                          oldText: phase === '1' ? 'first baseline' : 'second version',
                          newText: phase === '1' ? 'second version' : 'last version'
                        }
                      ]
                    },
                    summary: '修改文本'
                  })
                : complete('修改完成')
            })
          }
        })
        const output = await runner.run()
        const changes = (
          await runtime.storageService.aiFileChange.listRecords({ runId: runtime.runId })
        ).items
        const persisted = await fs.readFile(file, 'utf8')
        const files = new AiFileChangeService(runtime.storageService.aiFileChange)
        const editedDocx = (await mammoth.extractRawText({ path: docx })).value
        const docxChange = changes.find((change) => change.path === docx)
        const previewDocument = docxChange?.previewPath
          ? await readReviewPart(await fs.readFile(docxChange.previewPath))
          : undefined
        const preview = previewDocument
          ? [...storyText(previewDocument, false), ...storyText(previewDocument, true)].join('\n')
          : ''
        const textChange = changes.find((change) => change.path === file)
        const docxReverted = docxChange
          ? await files.revertRecord({ changeId: docxChange.id })
          : undefined
        const reverted = textChange
          ? await files.revertRecord({ changeId: textChange.id })
          : undefined
        return {
          output,
          changes,
          editedDocx,
          preview,
          docxReverted,
          docxRestored: (await fs.readFile(docx)).equals(docxBefore),
          persisted,
          reverted,
          restored: await fs.readFile(file, 'utf8'),
          events: runner.events.slice(),
          io: runner.io.slice()
        }
      },
      assert: async (result, runtime) => {
        expect(result.output.status).toBe('cancelled')
        expect(result.changes).toHaveLength(2)
        expect(result.changes.every((change) => change.runId === runtime.runId)).toBe(true)
        expect(result.editedDocx).toContain('Final docx')
        expect(result.preview).toContain('Hello from fixture')
        expect(result.preview).toContain('Final docx')
        expect(result.preview).not.toContain('Intermediate docx')
        expect(result.docxReverted?.success).toBe(true)
        expect(result.docxRestored).toBe(true)
        expect(result.persisted).toBe('last version\nprotected\n')
        expect(result.reverted?.success).toBe(true)
        expect(result.restored).toBe('first baseline\nprotected\n')
        const cancelled = result.events.filter(
          (event) => event.type === 'subagent_updated' && event.update.status === 'cancelled'
        )
        expect(cancelled).toHaveLength(3)
        expect(result.io.some((record) => record.user.includes('PHASE_QUEUED'))).toBe(false)
        for (const event of result.events)
          if (event.type === 'subagent_updated') {
            // No idle or running child terminal session may survive disposal.
            expect(
              terminalSessionManager.list({ chatSessionId: event.update.childRunId })
            ).toHaveLength(0)
          }
        runtime.assertThat(true, {
          name: 'parent-owned-revert',
          message: '子任务销毁后主 run 保留唯一文件记录并能回到首次基线'
        })
      }
    })
  })

  it('human-subagent-transcript-recovery', async () => {
    await runBackendCase({
      caseId: 'human-subagent-transcript-recovery',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      harnessMode: 'mock-llm',
      fixtures: [],
      runMode: 'single',
      description: '内存压缩投影与真实 SQLite 中断恢复',
      execute: async (runtime) => {
        const runner = await createAiServiceTestRunner(runtime, {
          userInput: '继续中断任务',
          llmScript: {
            'human.brain': [{ output: complete('读取已完成反馈后继续') }],
            'human.context_compaction': [{ text: 'COMPACT_CHILD' }, { text: 'COMPACT_CHILD' }]
          }
        })
        const tasks = [
          { name: '海豹', task: '独立任务 A' },
          { name: '水獭', task: '独立任务 B' }
        ]
        const update: SubagentUpdate = {
          toolCallId: 'dispatch-1',
          childRunId: 'child-a',
          ...tasks[0],
          status: 'completed',
          result: 'VERIFIED_A'
        }
        const entries: ChatMessageLogEntry[] = [
          {
            kind: 'assistant',
            content: '派发',
            toolCalls: [{ id: 'dispatch-1', name: 'delegate_to_subagent', args: { tasks } }]
          },
          { kind: 'annotation', eventType: 'subagent_updated', payload: update },
          {
            kind: 'annotation',
            eventType: 'subagent_updated',
            payload: {
              toolCallId: 'dispatch-1',
              childRunId: 'child-b',
              ...tasks[1],
              status: 'queued'
            }
          }
        ]
        await runtime.storageService.chatMessageLog.appendBatch({
          partnerId: runner.payload.partnerId,
          runId: 'interrupted-run',
          entries
        })
        const before = await runtime.storageService.chatMessageLog.list(runner.payload.partnerId)
        const repaired = repairInterruptedToolCalls(messagesFromLogEntries(entries), before)
        const memory = createMemoryTranscript(runner.payload.partnerId, 'child-memory')
        await memory.append([
          {
            kind: 'user',
            input: 'old',
            content: 'OLD_CONTEXT '.repeat(4000),
            context: { selectedReferences: [], attachments: [] }
          },
          { kind: 'assistant', content: '历史任务已结束', toolCalls: [] },
          {
            kind: 'user',
            input: 'next',
            content: '独立任务继续',
            context: { selectedReferences: [], attachments: [] }
          },
          { kind: 'assistant', content: 'KEPT_TAIL', toolCalls: [] }
        ])
        const childCtx = createAiRunContext(
          {
            ...runner.payload,
            runId: 'child-memory',
            ownerRunId: runtime.runId,
            parentToolCallId: 'compact-parent'
          },
          {
            ...runner.deps,
            transcript: memory,
            humanRuntimeOverrides: { modelContextWindowTokens: 4000 },
            sendEvent: (event) => runtime.eventCollector.add(event)
          }
        )
        await createContextCompactionNode({ ctx: childCtx, cache: createHumanRuntimeCache() })(
          createInitialHumanState({ taskId: 'child-memory', userInput: '独立任务继续' })
        )
        const projection = projectMessageLogRecords(await memory.load())
        memory.clear()
        const output = await runner.run()
        const after = await runtime.storageService.chatMessageLog.list(runner.payload.partnerId)
        return {
          output,
          repaired: repaired.map((message) => String(message.content)),
          projection,
          empty: (await memory.load()).length,
          before,
          after,
          io: runner.io.slice()
        }
      },
      assert: async (result, runtime) => {
        expect(result.output.status).toBe('completed')
        expect(result.repaired.join('\n')).toContain('VERIFIED_A')
        expect(result.repaired.join('\n')).toContain('执行被中断，未收到完整结果')
        expect(result.projection.historyFloorSeq).toBeGreaterThan(0)
        expect(result.projection.compactionCheckpoint?.summary).toContain('COMPACT_CHILD')
        expect(
          result.after.some(
            (record) =>
              record.entry.kind === 'annotation' &&
              record.entry.eventType === 'compaction_checkpoint'
          )
        ).toBe(false)
        expect(result.empty).toBe(0)
        expect(
          result.after.some(
            (record) =>
              record.entry.kind === 'tool' && record.entry.toolName === 'delegate_to_subagent'
          )
        ).toBe(false)
        expect(result.io.find((record) => record.runId === runtime.runId)?.user).toContain(
          'VERIFIED_A'
        )
        runtime.assertThat(true, {
          name: 'recover-without-resurrection',
          message: '修复仅用于模型投影，保留完成事实，不写虚构 tool 结果、不重启子实例'
        })
      }
    })
  })
})
