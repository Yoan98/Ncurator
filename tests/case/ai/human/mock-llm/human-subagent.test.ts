import fs from 'node:fs/promises'
import path from 'node:path'
import mammoth from 'mammoth'
import { createAiRunContext } from '../../../../../src/main/services/ai/runtime'
import { createContextCompactionNode } from '../../../../../src/main/services/ai/human/node/contextCompactionNode'
import { createHumanRuntimeCache } from '../../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../../src/main/services/ai/human/state/schema'
import { describe, it, expect } from 'vitest'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { createAiServiceTestRunner } from '../../../../harness/backend/aiServiceHarness'
import type { ScriptedLlmCall, ScriptedLlmStep } from '../../../../harness/backend/test-types'
import {
  buildCompleteTaskDecision,
  buildToolDecision,
  buildLearnSkillsDecision
} from '../testUtils'
import {
  projectMessageLogRecords,
  repairInterruptedToolCalls
} from '../../../../../src/main/services/ai/human/memory/transcript'
import { messagesFromLogEntries } from '../../../../../src/main/services/ai/human/memory/conversationLogMessages'
import { createMemoryTranscript } from '../../../../../src/main/services/ai/run/subagents'
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
        const started = new Set<string>()
        let releaseChildren: () => void = () => {}
        const bothStarted = new Promise<void>((resolve) => {
          releaseChildren = resolve
        })
        const runner = await createAiServiceTestRunner(runtime, {
          userInput: 'PARENT_SECRET 只存在主聊天',
          llmScript: {
            'human.brain': steps(async (call) => {
              if (!isChild(call))
                return ++parentCalls === 1
                  ? delegate([
                      { name: '海豹', task: 'CHILD_ALPHA 独立查验 A' },
                      { name: '水獭', task: 'CHILD_BETA 独立查验 B' }
                    ])
                  : complete('主伙伴汇集完成')
              inputs.push(call.user)
              const task = call.user.includes('CHILD_ALPHA') ? 'A' : 'B'
              started.add(task)
              if (started.size === 2) releaseChildren()
              await bothStarted
              return complete(`RESULT_${task} 核对完成`)
            })
          }
        })
        const output = await runner.run()
        const records = await runtime.storageService.chatMessageLog.list(runner.payload.partnerId)
        return { output, records, inputs, events: runner.events.slice(), io: runner.io.slice() }
      },
      assert: async (result, runtime) => {
        expect(result.output.status).toBe('completed')
        expect(result.inputs).toHaveLength(2)
        expect(result.inputs.every((input) => !input.includes('PARENT_SECRET'))).toBe(true)
        const terminal = result.records.filter(
          (record) =>
            record.entry.kind === 'annotation' &&
            record.entry.eventType === 'subagent_updated' &&
            record.entry.payload.status === 'completed'
        )
        expect(terminal).toHaveLength(2)
        expect(result.records.every((record) => record.runId === runtime.runId)).toBe(true)
        expect(
          result.records.filter(
            (record) => record.entry.kind === 'assistant' && record.entry.toolCalls.length === 0
          )
        ).toHaveLength(1)
        expect(result.events.filter((event) => event.type === 'answer_completed')).toHaveLength(1)
        expect(result.io.filter((record) => record.ownerRunId === runtime.runId)).toHaveLength(2)
        runtime.assertThat(
          result.records.some(
            (record) =>
              record.entry.kind === 'tool' &&
              record.entry.toolName === 'delegate_to_subagent' &&
              record.entry.content.includes('RESULT_A') &&
              record.entry.content.includes('RESULT_B')
          ),
          {
            name: 'aggregate-result',
            message: '子结果汇入一条主工具结果，子完整 transcript 不落盘'
          }
        )
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
                return delegate([{ name: `海豹${phase}`, task: `PHASE_${phase} 修改 ${file}` }])
              }
              const phase = call.user.match(/PHASE_(\d)/)?.[1] || '1'
              const count = (childCalls.get(phase) || 0) + 1
              childCalls.set(phase, count)
              if (phase === '3') {
                controller.abort()
                return complete('等待取消')
              }
              if (count === 2)
                return buildLearnSkillsDecision({ skillIds: ['docx-read', 'docx-write'], summary: '文档编辑' })
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
        const preview = docxChange?.previewPath
          ? (await mammoth.extractRawText({ path: docxChange.previewPath })).value
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
          events: runner.events.slice()
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
        expect(cancelled).toHaveLength(1)
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
          { kind: 'annotation', eventType: 'subagent_updated', payload: update }
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
