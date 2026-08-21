import { describe, expect, it } from 'vitest'
import {
  appendRoundRecord,
  buildHandExecution
} from '../../../../src/main/services/ai/human/memory/rounds'
import { createMouthNode } from '../../../../src/main/services/ai/human/node/mouthNode'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import type { AiRunContext } from '../../../../src/main/services/ai/types'
import type { AiFileChangeRecord, AiRunEvent } from '../../../../src/shared/types'

const createBaseContext = (input: {
  events: AiRunEvent[]
  onChatText: (input: { user: string; onTextDelta?: (text: string) => void }) => Promise<string>
  fileChangeRecords?: AiFileChangeRecord[]
}): AiRunContext =>
  ({
    runId: 'run-1',
    platform: 'macos',
    referenceScope: {
      workspace: {
        workspaceId: 'ws-1',
        workspaceName: 'Workspace',
        rootPath: '/tmp/workspace'
      },
      selectedReferences: []
    },
    workspace: {
      workspaceId: 'ws-1',
      workspaceName: 'Workspace',
      rootPath: '/tmp/workspace'
    },
    checkCancelled: () => undefined,
    chatStructured: async () => {
      throw new Error('not used in mouth node test')
    },
    chatText: async ({ user, onTextDelta }) => input.onChatText({ user, onTextDelta }),
    sendEvent: (event) => input.events.push(event),
    requestApprovalBatch: async () => ({
      accepted: true,
      decisions: []
    }),
    loadConversationContext: async () => ({
      recentTurnsText: '',
      conversationSummaryText: ''
    }),
    loadConversationMemory: async () => null,
    trackDocxOpen: () => undefined,
    trackDocxChanges: () => undefined,
    trackDocxBatchChanges: () => undefined,
    resolveDocxOpenTarget: async () => {
      throw new Error('not used in mouth node test')
    },
    beginDocxApplyRun: () => undefined,
    applyDocxRunEdits: async () => [],
    discardDocxApplyRun: () => undefined,
    saveFileChangeRecord: async () => undefined,
    listFileChangeRecords: async () =>
      input.fileChangeRecords || [
        {
          id: 'terminal-change-1',
          sessionId: 'session-1',
          runId: 'run-1',
          status: 'applied',
          capability: 'terminal_exec',
          path: '/tmp/workspace/report.md',
          fileName: 'report.md',
          operation: 'created',
          changeCount: 1,
          insertCount: 1,
          deleteCount: 0,
          createdAt: 1,
          updatedAt: 1
        }
      ],
    documentsStore: {} as AiRunContext['documentsStore'],
    embeddingService: {} as AiRunContext['embeddingService']
  }) satisfies AiRunContext

describe('ai unit mouth node', () => {
  it('appends a mouth round before prompt generation and does not append another one on completion', async () => {
    const events: AiRunEvent[] = []
    let capturedUserPrompt = ''
    const ctx = createBaseContext({
      events,
      onChatText: async ({ user }) => {
        capturedUserPrompt = user
        return '# 最终交付\n\n总结文件已经整理完毕。'
      }
    })
    const cache = createHumanRuntimeCache()
    const node = createMouthNode({
      ctx,
      cache,
      emitAnswerEvents: false
    })

    const initialState = createInitialHumanState({
      taskId: 'task-mouth-node',
      userInput: '整理最终交付'
    })
    initialState.memory.todolist = [
      {
        item: '核对最终产物',
        status: 'done'
      }
    ]
    initialState.execution.stage = 'mouth'
    initialState.execution.currentThought = {
      thought: {
        next: '复习总结文件已生成完毕，基于现有结果组织最终交付'
      },
      nextAction: {
        action: 'mouth',
        evidenceReferences: [
          {
            label: '深度学习.docx',
            path: '学习笔记/深度学习.docx',
            resourceType: 'file',
            usedFor: '支撑深度学习部分的总结内容'
          }
        ]
      }
    }
    initialState.memory.taskRun = appendRoundRecord({
      state: initialState,
      thought: {
        next: '先整理两份资料并生成总结文件'
      },
      nextAction: {
        action: 'hand',
        calls: [
          {
            toolName: 'docx_edit',
            args: {
              sourcePath: '深度学习与图形学复习总结.docx',
              actions: [
                {
                  type: 'insert_blocks',
                  blocks: [{ type: 'paragraph', text: '总结正文' }]
                }
              ]
            }
          }
        ]
      },
      execution: buildHandExecution({
        calls: [
          {
            toolName: 'docx_edit',
            args: {
              sourcePath: '深度学习与图形学复习总结.docx',
              actions: [
                {
                  type: 'insert_blocks',
                  blocks: [{ type: 'paragraph', text: '总结正文' }]
                }
              ]
            }
          }
        ],
        toolResults: [
          {
            toolName: 'docx_edit',
            ok: true,
            data: {
              sourcePath: '深度学习与图形学复习总结.docx',
              currentRevisionRef: 'rev-1',
              createdBlocks: [{ blockId: 'b:0', type: 'paragraph' }],
              postWriteReadback: {
                regions: [
                  {
                    fromBlockIndex: 0,
                    toBlockIndex: 0,
                    blocks: [
                      {
                        blockId: 'b:0',
                        type: 'paragraph',
                        blockIndex: 0,
                        text: '总结正文'
                      }
                    ]
                  }
                ]
              }
            }
          }
        ]
      }),
      createdAt: 1
    })

    const nextState = await node(initialState)
    const roundsSection =
      capturedUserPrompt.match(/<rounds>([\s\S]*?)<\/rounds>/)?.[1] || ''

    expect(nextState.memory.taskRun.rounds).toHaveLength(2)
    expect(
      nextState.memory.taskRun.rounds.filter((round) => round.execution.kind === 'mouth')
    ).toHaveLength(1)
    expect(nextState.memory.taskRun.rounds.at(-1)).toMatchObject({
      thought: { next: '复习总结文件已生成完毕，基于现有结果组织最终交付' },
      execution: {
        kind: 'mouth',
        result: '已完成最终交付。'
      }
    })
    expect(roundsSection).toContain('复习总结文件已生成完毕，基于现有结果组织最终交付')
    expect(roundsSection).toContain('类型：mouth')
    expect(roundsSection).toContain('结果：已完成最终交付。')
    expect(capturedUserPrompt).toContain('文件：report.md')
    expect(capturedUserPrompt).toContain('来源能力：terminal_exec')
    expect(capturedUserPrompt).toContain('修改记录：terminal-change-1')
    expect(capturedUserPrompt).toContain('accessStatus=unavailable')
    expect(nextState.execution.evidenceReferences).toEqual([
      {
        label: '深度学习.docx',
        path: '学习笔记/深度学习.docx',
        resourceType: 'file',
        usedFor: '支撑深度学习部分的总结内容',
        accessStatus: 'unavailable'
      }
    ])
    expect(nextState.execution.status).toBe('completed')
    expect(nextState.result?.deliveryMarkdown).toBe('# 最终交付\n\n总结文件已经整理完毕。')
    expect(nextState.trace.steps.at(-1)).toMatchObject({
      action: 'deliver_result',
      summary: '已完成最终交付'
    })
    expect(
      events.some((event) => event.type === 'human_step' && event.action === 'deliver_result')
    ).toBe(true)
  })

  it('emits finalizing before streaming mouth answer events', async () => {
    const events: AiRunEvent[] = []
    const ctx = createBaseContext({
      events,
      onChatText: async ({ onTextDelta }) => {
        onTextDelta?.('收尾')
        return '收尾完成'
      }
    })
    const cache = createHumanRuntimeCache()
    const node = createMouthNode({
      ctx,
      cache,
      emitAnswerEvents: true
    })
    const initialState = createInitialHumanState({
      taskId: 'task-mouth-finalizing',
      userInput: '整理最终交付'
    })
    initialState.execution.stage = 'mouth'
    initialState.execution.currentThought = {
      thought: {
        next: '已经完成主要步骤，进入最终收尾'
      },
      nextAction: {
        action: 'mouth'
      }
    }

    await node(initialState)

    const finalizingIndex = events.findIndex(
      (event) =>
        event.type === 'assistant_process_group_started' && event.display.kind === 'finalizing'
    )
    const answerTokenIndex = events.findIndex((event) => event.type === 'answer_token')
    const answerCompletedIndex = events.findIndex((event) => event.type === 'answer_completed')

    expect(finalizingIndex).toBeGreaterThanOrEqual(0)
    expect(answerTokenIndex).toBeGreaterThan(finalizingIndex)
    expect(answerCompletedIndex).toBeGreaterThan(answerTokenIndex)
    expect(events[finalizingIndex]).toMatchObject({
      type: 'assistant_process_group_started',
      groupId: 'run-1:finalizing',
      kind: 'finalizing',
      display: { kind: 'finalizing' }
    })
  })

  it('uses deterministic delivery text after a mouth content-safety failure', async () => {
    const events: AiRunEvent[] = []
    let applyCalled = false
    const ctx = createBaseContext({
      events,
      onChatText: async () => {
        throw new Error(
          'text_output_failed; caller=human.mouth; reason=400 Input data may contain inappropriate content; code=inappropriate-content'
        )
      }
    })
    ctx.applyDocxRunEdits = async () => {
      applyCalled = true
      return []
    }
    const node = createMouthNode({
      ctx,
      cache: createHumanRuntimeCache(),
      emitAnswerEvents: true
    })
    const state = createInitialHumanState({ taskId: 'mouth-safety', userInput: 'create file' })
    state.execution.stage = 'mouth'
    state.execution.currentThought = {
      thought: { next: 'finalize' },
      nextAction: { action: 'mouth' }
    }
    state.execution.finalizationReason = 'brain_content_safety'
    state.memory.todolist = [{ item: 'unfinished item', status: 'todo' }]
    state.execution.deliveryGuidanceItems = [{ source: 'brain', text: '请调整输入后重试。' }]

    const result = await node(state)

    expect(applyCalled).toBe(true)
    expect(result.execution.status).toBe('completed')
    expect(result.result?.deliveryMarkdown).toContain('内容安全策略限制')
    expect(result.result?.deliveryMarkdown).toContain('请调整输入后重试。')
    expect(events.some((event) => event.type === 'answer_completed')).toBe(true)
  })

  it('lets mouth normally render guidance after a brain content-safety transition', async () => {
    let capturedPrompt = ''
    const ctx = createBaseContext({
      events: [],
      onChatText: async ({ user }) => {
        capturedPrompt = user
        return '根据收尾提示完成说明。'
      }
    })
    const node = createMouthNode({
      ctx,
      cache: createHumanRuntimeCache(),
      emitAnswerEvents: false
    })
    const state = createInitialHumanState({ taskId: 'brain-to-mouth', userInput: 'continue' })
    state.execution.stage = 'mouth'
    state.execution.finalizationReason = 'brain_content_safety'
    state.execution.currentThought = {
      thought: { next: '进入收尾' },
      nextAction: { action: 'mouth' }
    }
    state.memory.todolist = [{ item: '未完成事项', status: 'todo' }]
    state.execution.deliveryGuidanceItems = [{ source: 'brain', text: '请调整输入后重试。' }]

    const result = await node(state)

    expect(capturedPrompt).toContain('请调整输入后重试。')
    expect(result.result?.deliveryMarkdown).toBe('根据收尾提示完成说明。')
  })

  it('keeps non-content-safety mouth failures unchanged', async () => {
    const ctx = createBaseContext({
      events: [],
      onChatText: async () => {
        throw new Error('text_output_failed; reason=400 invalid request')
      }
    })
    const node = createMouthNode({
      ctx,
      cache: createHumanRuntimeCache(),
      emitAnswerEvents: false
    })
    const state = createInitialHumanState({ taskId: 'mouth-error', userInput: 'create file' })
    state.execution.stage = 'mouth'
    state.execution.currentThought = {
      thought: { next: 'finalize' },
      nextAction: { action: 'mouth' }
    }

    await expect(node(state)).rejects.toThrow('invalid request')
  })
})
