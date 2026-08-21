import { describe, expect, it } from 'vitest'
import { buildMouthPrompt } from '../../../../src/main/services/ai/human/prompts/mouth'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import type { AiRunContext } from '../../../../src/main/services/ai/types'

const createFakeCtx = (): AiRunContext =>
  ({
    platform: 'darwin',
    runId: 'run-1',
    workspace: {
      id: 'ws-1',
      rootPath: '/tmp/workspace'
    },
    referenceScope: {
      workspace: {
        id: 'ws-1',
        rootPath: '/tmp/workspace'
      },
      selectedReferences: []
    }
  }) as AiRunContext

describe('ai unit mouth prompt contract', () => {
  it('renders todolist and all recent rounds including the latest mouth round', () => {
    const state = createInitialHumanState({
      taskId: 'task-mouth-progress',
      userInput: '整理最终交付'
    })

    state.memory.todolist = [
      {
        item: '核对最终产物',
        status: 'done'
      }
    ]

    state.execution.currentThought = {
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
    state.execution.evidenceReferences = [
      {
        label: '深度学习.docx',
        path: '学习笔记/深度学习.docx',
        resourceType: 'file',
        usedFor: '支撑深度学习部分的总结内容',
        accessStatus: 'accessible'
      }
    ]

    state.memory.taskRun.rounds = [
      {
        roundId: 1,
        createdAt: 1,
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
        execution: {
          kind: 'hand',
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
        }
      },
      {
        roundId: 2,
        createdAt: 2,
        thought: state.execution.currentThought.thought,
        nextAction: state.execution.currentThought.nextAction,
        execution: {
          kind: 'mouth',
          result: '已完成最终交付。'
        }
      }
    ]

    const prompt = buildMouthPrompt({
      state,
      ctx: createFakeCtx()
    })
    const todolistSection =
      prompt.user.match(/<todolist>([\s\S]*?)<\/todolist>/)?.[1] || ''
    const roundsSection =
      prompt.user.match(/<rounds>([\s\S]*?)<\/rounds>/)?.[1] || ''

    expect(prompt.system).toContain('todolist：当前任务的待办路径。')
    expect(todolistSection).toContain('核对最终产物')
    expect(roundsSection).toContain('先整理两份资料并生成总结文件')
    expect(roundsSection).toContain('复习总结文件已生成完毕，基于现有结果组织最终交付')
    expect(roundsSection).toContain('类型：mouth')
    expect(roundsSection).toContain('结果：已完成最终交付。')
    expect(roundsSection).toContain('类型：hand')
    expect(prompt.user).toContain('深度学习与图形学复习总结.docx')
    expect(prompt.user).toContain('引用资料：深度学习.docx')
    expect(prompt.user).toContain('正文引用片段：[深度学习.docx](ncurator://ref?kind=reference')
    expect(prompt.user).toContain('resourceType=file')
    expect(prompt.user).toContain('accessStatus=accessible')
  })
})
