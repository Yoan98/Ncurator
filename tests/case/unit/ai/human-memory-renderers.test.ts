import { describe, expect, it } from 'vitest'
import {
  renderHumanThought,
  renderTaskProgress
} from '../../../../src/main/services/ai/human/shared/memoryRenderers'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import { appendRoundRecord, buildHandExecution } from '../../../../src/main/services/ai/human/memory/rounds'
import {
  renderBrainRoundExecutionOnly,
  renderBrainRoundSection
} from '../../../../src/main/services/ai/human/shared/historyRenderers'

describe('ai unit human memory renderers', () => {
  it('renders thought as global progress only without thought.next', () => {
    const state = createInitialHumanState({
      taskId: 'task-thought-render',
      userInput: '继续推进'
    })

    state.memory.thought = {
      next: '这一轮判断不应显示在 thought 区块',
      todolist: [
        {
          item: '核对工作区文件',
          status: 'todo'
        }
      ],
      progressionSummary: '已经建立任务推进基线。'
    }

    const text = renderHumanThought(state, 'brain_prompt')

    expect(text).toContain('待办路径：')
    expect(text).toContain('推进摘要：')
    expect(text).toContain('核对工作区文件')
    expect(text).toContain('已经建立任务推进基线。')
    expect(text).not.toContain('当前与下一步：')
    expect(text).not.toContain('这一轮判断不应显示在 thought 区块')
  })

  it('renders task_progress with latest decision and execution in fixed format', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-progress-render',
      userInput: '继续推进'
    })

    initialState.memory.thought = {
      next: '旧 thought.next 不应直接作为 task_progress 主体',
      todolist: [
        {
          item: '核对工作区文件',
          status: 'todo'
        }
      ],
      progressionSummary: '已经建立任务推进基线。'
    }

    const taskRun = appendRoundRecord({
      state: initialState,
      thought: {
        thought: {
          next: '先读取 release-note.txt 确认最新状态'
        },
        nextAction: {
          action: 'hand',
          calls: [
            {
              toolName: 'terminal_run',
              args: {
                command: 'cat release-note.txt'
              }
            }
          ]
        }
      },
      execution: buildHandExecution({
        calls: [
          {
            toolName: 'terminal_run',
            args: {
              command: 'cat release-note.txt'
            }
          }
        ],
        toolResults: [
          {
            toolName: 'terminal_run',
            ok: true,
            data: {
              stdout: 'latest release status',
              exitCode: 0,
              timedOut: false
            }
          }
        ]
      }),
      createdAt: 1
    })

    const state = {
      ...initialState,
      memory: {
        ...initialState.memory,
        taskRun
      }
    }
    const latestRound = state.memory.taskRun.rounds.at(-1)
    const text = renderTaskProgress({
      state,
      latestRound,
      latestExecutionText: renderBrainRoundExecutionOnly(latestRound),
      mode: 'brain_prompt'
    })

    expect(text).toContain('最新一轮决策如下')
    expect(text).toContain('待办路径：')
    expect(text).toContain('推进摘要：')
    expect(text).toContain('判断：')
    expect(text).toContain('执行：')
    expect(text).toContain('核对工作区文件')
    expect(text).toContain('已经建立任务推进基线。')
    expect(text).toContain('先读取 release-note.txt 确认最新状态')
    expect(text).toContain('类型：hand')
    expect(text).toContain('latest release status')
    expect(text).toContain('参数：{"command":"cat release-note.txt"}')
    expect(text).toContain('返回：{"stdout":"latest release status","exitCode":0,"timedOut":false}')
    expect(text).toContain('"stdout":"latest release status"')
    expect(text).not.toContain('args=')
    expect(text).not.toContain('result:')
    expect(text).not.toContain('旧 thought.next 不应直接作为 task_progress 主体')
  })

  it('renders history tool results with boolean-tree filtered compact json', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-history-whitelist',
      userInput: '继续推进'
    })

    const taskRun = appendRoundRecord({
      state: initialState,
      thought: {
        thought: {
          next: '读取文档块并保留必要字段'
        },
        nextAction: {
          action: 'hand',
          calls: [
            {
              toolName: 'docx_edit',
              args: {
                sourcePath: 'draft.docx',
                actions: [{
                  type: 'create_document',
                  blocks: [{ type: 'paragraph', text: '...' }]
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
              sourcePath: 'draft.docx',
              actions: [{
                type: 'create_document',
                blocks: [{ type: 'paragraph', text: '...' }]
              }]
            }
          }
        ],
        toolResults: [
          {
            toolName: 'docx_edit',
            ok: true,
            data: {
              sourcePath: 'draft.docx',
              previousRevisionRef: 'rev-1',
              currentRevisionRef: 'rev-2',
              createdBlocks: [{ blockId: 'b:0', type: 'paragraph' }],
              ignoredTopLevelField: 'drop-me',
              postWriteReadback: {
                ignoredObjectField: 'drop-me',
                regions: [
                  {
                    fromBlockIndex: 1,
                    toBlockIndex: 2,
                    ignoredRegionField: 'drop-me',
                    blocks: [
                      {
                        blockId: 'b1',
                        type: 'paragraph',
                        blockIndex: 1,
                        text: 'hello',
                        ignoredBlockField: 'drop-me'
                      }
                    ]
                  }
                ]
              }
            },
            diagnostic: {
              message: 'write verified'
            }
          }
        ]
      }),
      createdAt: 1
    })

    const rendered = renderBrainRoundSection(taskRun.rounds)

    expect(rendered).toContain('第 1 轮')
    expect(rendered).toContain(
      '参数：{"sourcePath":"draft.docx","actions":[{"type":"create_document","blocks":[{"type":"paragraph","text":"..."}]}]}'
    )
    expect(rendered).toContain(
      '"postWriteReadback":{"regions":[{"fromBlockIndex":1,"toBlockIndex":2,"blocks":[{"blockId":"b1","type":"paragraph","blockIndex":1,"text":"hello"}]}]}'
    )
    expect(rendered).not.toContain('previousRevisionRef')
    expect(rendered).not.toContain('currentRevisionRef')
    expect(rendered).not.toContain('createdBlocks')
    expect(rendered).toContain('诊断：\ndiagnostic=write verified')
    expect(rendered).not.toContain('ignoredTopLevelField')
    expect(rendered).not.toContain('ignoredObjectField')
    expect(rendered).not.toContain('ignoredRegionField')
    expect(rendered).not.toContain('ignoredBlockField')
  })

  it('renders kb_list_documents result ids in round history', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-history-kb-list-documents',
      userInput: '列出知识库文档'
    })

    const taskRun = appendRoundRecord({
      state: initialState,
      thought: {
        thought: {
          next: '查看知识库可检索文档列表'
        },
        nextAction: {
          action: 'hand',
          calls: [
            {
              toolName: 'kb_list_documents',
              args: {
                page: 1,
                pageSize: 20
              }
            }
          ]
        }
      },
      execution: buildHandExecution({
        calls: [
          {
            toolName: 'kb_list_documents',
            args: {
              page: 1,
              pageSize: 20
            }
          }
        ],
        toolResults: [
          {
            toolName: 'kb_list_documents',
            ok: true,
            data: {
              items: [
                {
                  id: 'workspace-file-doc-1',
                  name: '图形学.docx',
                  file_path: '/tmp/workspace/学习笔记/图形学.docx'
                }
              ],
              total: 1
            }
          }
        ]
      }),
      createdAt: 1
    })

    const rendered = renderBrainRoundSection(taskRun.rounds)

    expect(rendered).toContain('"id":"workspace-file-doc-1"')
    expect(rendered).toContain('"name":"图形学.docx"')
    expect(rendered).toContain('"total":1')
    expect(rendered).not.toContain('file_path')
  })

  it('renders unconfigured tool results with fallback minimal fields only', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-history-fallback',
      userInput: '继续推进'
    })

    const taskRun = appendRoundRecord({
      state: initialState,
      thought: {
        thought: {
          next: '执行未配置工具'
        },
        nextAction: {
          action: 'hand',
          calls: [
            {
              toolName: 'custom_tool',
              args: {
                value: 1
              }
            }
          ]
        }
      },
      execution: buildHandExecution({
        calls: [
          {
            toolName: 'custom_tool',
            args: {
              value: 1
            }
          }
        ],
        toolResults: [
          {
            toolName: 'custom_tool',
            ok: false,
            data: {
              message: 'fallback message',
              error: 'fallback error',
              stdout: 'drop stdout',
              nested: {
                keep: false
              }
            }
          }
        ]
      }),
      createdAt: 1
    })

    const rendered = renderBrainRoundSection(taskRun.rounds)

    expect(rendered).toContain('"message":"fallback message","error":"fallback error"')
    expect(rendered).not.toContain('drop stdout')
    expect(rendered).not.toContain('"nested"')
  })
})
