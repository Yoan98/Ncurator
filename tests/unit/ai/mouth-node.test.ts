import { describe, expect, it } from 'vitest'
import { appendRoundRecord, buildHandExecution } from '../../../src/main/services/ai/human/memory/rounds'
import { createMouthNode } from '../../../src/main/services/ai/human/node/mouthNode'
import { createHumanRuntimeCache } from '../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../src/main/services/ai/human/state/schema'
import type { AiRunContext } from '../../../src/main/services/ai/types'
import type { AiRunEvent } from '../../../src/shared/types'

const createBaseContext = (input: {
  events: AiRunEvent[]
  onChatText: (user: string) => Promise<string>
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
    chatText: async ({ user }) => input.onChatText(user),
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
    documentsStore: {} as AiRunContext['documentsStore'],
    embeddingService: {} as AiRunContext['embeddingService']
  }) satisfies AiRunContext

describe('ai unit mouth node', () => {
  it('appends a mouth round before prompt generation and does not append another one on completion', async () => {
    const events: AiRunEvent[] = []
    let capturedUserPrompt = ''
    const ctx = createBaseContext({
      events,
      onChatText: async (user) => {
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
    initialState.memory.thought = {
      next: '旧 thought.next 不应直接作为 mouth task_progress 主体',
      todolist: [
        {
          item: '核对最终产物',
          status: 'todo'
        }
      ],
      progressionSummary: '总结文件已写入完成，正在准备最终交付。'
    }
    initialState.execution.stage = 'mouth'
    initialState.execution.currentThought = {
      thought: {
        next: '复习总结文件已生成完毕，基于现有结果组织最终交付'
      },
      nextAction: {
        action: 'mouth',
        references: [
          {
            label: '深度学习.docx',
            path: '学习笔记/深度学习.docx',
            usedFor: '支撑深度学习部分的总结内容'
          }
        ]
      }
    }
    initialState.memory.taskRun = appendRoundRecord({
      state: initialState,
      thought: {
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
                actions: [{
                  type: 'create_document',
                  blocks: [{ type: 'paragraph', text: '总结正文' }]
                }]
              }
            }
          ]
        }
      },
      execution: buildHandExecution({
        calls: [
          {
            toolName: 'docx_edit',
            args: {
              sourcePath: '深度学习与图形学复习总结.docx',
              actions: [{
                type: 'create_document',
                blocks: [{ type: 'paragraph', text: '总结正文' }]
              }]
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
    const taskProgressSection =
      capturedUserPrompt.match(/<task_progress>([\s\S]*?)<\/task_progress>/)?.[1] || ''

    expect(nextState.memory.taskRun.rounds).toHaveLength(2)
    expect(nextState.memory.taskRun.rounds.filter((round) => round.execution.kind === 'mouth')).toHaveLength(1)
    expect(nextState.memory.taskRun.rounds.at(-1)).toMatchObject({
      thought: initialState.execution.currentThought,
      execution: {
        kind: 'mouth',
        action: 'deliver_result'
      }
    })
    expect(taskProgressSection).toContain('复习总结文件已生成完毕，基于现有结果组织最终交付')
    expect(taskProgressSection).toContain('类型：mouth')
    expect(taskProgressSection).toContain('动作：组织最终交付')
    expect(taskProgressSection).not.toContain('类型：hand')
    expect(nextState.execution.status).toBe('completed')
    expect(nextState.result?.deliveryMarkdown).toBe('# 最终交付\n\n总结文件已经整理完毕。')
    expect(nextState.trace.steps.at(-1)).toMatchObject({
      action: 'deliver_result',
      summary: '已完成最终交付'
    })
    expect(events.some((event) => event.type === 'human_step' && event.action === 'deliver_result')).toBe(
      true
    )
  })
})
