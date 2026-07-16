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
  it('renders latest decision and execution in task_progress with the same contract as brain', () => {
    const state = createInitialHumanState({
      taskId: 'task-mouth-progress',
      userInput: '整理最终交付'
    })

    state.memory.thought = {
      next: '旧 thought.next 不应直接作为 mouth task_progress 主体',
      todolist: [
        {
          item: '核对最终产物',
          status: 'todo'
        }
      ],
      progressionSummary: '总结文件已写入完成，正在准备最终交付。'
    }

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
                      type: 'create_document',
                      blocks: [{ type: 'paragraph', text: '总结正文' }]
                    }
                  ]
                }
              }
            ]
          }
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
                    type: 'create_document',
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
        thought: state.execution.currentThought,
        execution: {
          kind: 'mouth',
          action: 'deliver_result'
        }
      }
    ]

    const prompt = buildMouthPrompt({
      state,
      ctx: createFakeCtx()
    })
    const taskProgressSection =
      prompt.user.match(/<task_progress>([\s\S]*?)<\/task_progress>/)?.[1] || ''

    expect(prompt.system).toContain(
      'task_progress：当前任务已经收敛的全局进度信息，包含待办路径、推进摘要，以及最新一轮判断和执行。'
    )
    expect(taskProgressSection).toContain('最新一轮决策如下')
    expect(taskProgressSection).toContain('待办路径：')
    expect(taskProgressSection).toContain('推进摘要：')
    expect(taskProgressSection).toContain('判断：')
    expect(taskProgressSection).toContain('执行：')
    expect(taskProgressSection).toContain('核对最终产物')
    expect(taskProgressSection).toContain('总结文件已写入完成，正在准备最终交付。')
    expect(taskProgressSection).toContain('复习总结文件已生成完毕，基于现有结果组织最终交付')
    expect(taskProgressSection).toContain('类型：mouth')
    expect(taskProgressSection).toContain('动作：组织最终交付')
    expect(taskProgressSection).not.toContain('类型：hand')
    expect(taskProgressSection).not.toContain(
      '旧 thought.next 不应直接作为 mouth task_progress 主体'
    )
    expect(prompt.user).toContain('深度学习与图形学复习总结.docx')
    expect(prompt.user).toContain('引用资料：深度学习.docx')
    expect(prompt.user).toContain('正文引用片段：[深度学习.docx](ncurator://ref?kind=reference')
    expect(prompt.user).toContain('resourceType=file')
    expect(prompt.user).toContain('accessStatus=accessible')
  })
})
