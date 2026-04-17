import { describe, expect, it } from 'vitest'
import type { AiRunContext } from '../../../src/main/services/ai/types'
import {
  appendRoundRecord,
  buildHandExecution,
  buildLearningExecution
} from '../../../src/main/services/ai/human/memory/roundHistory'
import { buildBrainPrompt } from '../../../src/main/services/ai/human/prompts/brain'
import { buildReferenceScope } from '../../../src/main/services/ai/prompts/referenceScope'
import { createInitialHumanState } from '../../../src/main/services/ai/human/state/schema'
import type { HumanDecision } from '../../../src/main/services/ai/human/types'

const createStubAiRunContext = (referenceScope: AiRunContext['referenceScope']): AiRunContext => ({
  runId: 'run-test',
  referenceScope,
  checkCancelled: () => {},
  chatStructured: async () => {
    throw new Error('chatStructured should not be called in prompt unit tests')
  },
  sendEvent: () => {},
  requestApproval: async () => ({
    approved: false
  }),
  loadHistory: async () => ({
    recentTurnsText: '',
    sessionSummaryText: ''
  }),
  trackDocxOpen: () => {},
  trackDocxChanges: () => {},
  resolveDocxOpenTarget: async () => {
    throw new Error('resolveDocxOpenTarget should not be called in prompt unit tests')
  },
  documentsStore: undefined as never,
  embeddingService: undefined as never
})

const buildDecision = (input: {
  summary: string
  reason: string
  expectedOutcome: string
  nextAction: HumanDecision['nextAction']
}): HumanDecision => ({
  decision: {
    summary: input.summary,
    reason: input.reason,
    expectedOutcome: input.expectedOutcome
  },
  readyToDeliver: false,
  nextAction: input.nextAction
})

describe('ai unit brain prompt history blocks', () => {
  it('renders the key history and decision contracts in the brain prompt', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-history-prompt',
      userInput: '请继续推进这个任务'
    })

    const withLearningRound = {
      ...initialState,
      skills: {
        learnedSkillIds: ['workspace-cli']
      },
      memory: {
        ...initialState.memory,
        history: appendRoundRecord({
          state: initialState,
          decision: buildDecision({
            summary: '先补齐 workspace 能力',
            reason: '还缺 terminal 能力。',
            expectedOutcome: '拿到命令执行能力后再继续。',
            nextAction: {
              action: 'learning',
              wantLearnSkillIds: ['workspace-cli']
            }
          }),
          execution: buildLearningExecution({
            learningOutcome: {
              requestedSkillIds: ['workspace-cli'],
              loadedSkillIds: ['workspace-cli'],
              skippedDuplicateSkillIds: [],
              skippedUnknownSkillIds: [],
              evictedSkillIds: [],
              activeToolCount: 1
            }
          }),
          createdAt: 1
        })
      }
    }

    const withHandRound = {
      ...withLearningRound,
      memory: {
        ...withLearningRound.memory,
        history: appendRoundRecord({
          state: withLearningRound,
          decision: buildDecision({
            summary: '读取工作区路径',
            reason: '已经具备 workspace-cli。',
            expectedOutcome: '确认当前 workspace 根路径。',
            nextAction: {
              action: 'hand',
              toolUsePlan: {
                mode: 'serial',
                calls: [
                  {
                    toolName: 'workspace_run_command',
                    args: {
                      command: 'pwd'
                    }
                  }
                ]
              }
            }
          }),
          execution: buildHandExecution({
            toolUsePlan: {
              mode: 'serial',
              calls: [
                {
                  toolName: 'workspace_run_command',
                  args: {
                    command: 'pwd'
                  }
                }
              ]
            },
            toolResults: [
              {
                toolName: 'workspace_run_command',
                ok: true,
                code: 'ok',
                data: {
                  ok: true,
                  code: 'ok',
                  outputPreview: '/workspace/root'
                }
              }
            ]
          }),
          createdAt: 2
        }),
      }
    }

    const state = {
      ...withHandRound,
      memory: {
        ...withHandRound.memory,
        history: {
          ...withHandRound.memory.history,
          loadedHistoryContext: {
            filters: {
              query: 'learning',
              limit: 1
            },
            rounds: [withHandRound.memory.history.roundHistory[0]]
          }
        }
      }
    }
    const prompt = buildBrainPrompt({
      state,
      ctx: createStubAiRunContext(
        buildReferenceScope({
          workspace: {
            workspaceId: 'workspace-1',
            workspaceName: 'workspace',
            rootPath: '/tmp/workspace-root'
          },
          selectedReferences: [
            {
              kind: 'file',
              workspaceId: 'workspace-1',
              nodeId: 'node-1',
              name: 'weekly-risk.md',
              relativePath: 'reports/weekly-risk.md',
              absolutePath: '/tmp/workspace-root/reports/weekly-risk.md',
              kbAvailability: 'indexed',
              kbDocumentIds: ['doc-1']
            }
          ]
        })
      )
    })

    expect(prompt.user).toContain('<reference_scope>')
    expect(prompt.user).toContain('<memory>')
    expect(prompt.user).toContain('<recent_progress>')
    expect(prompt.user).toContain('<earlier_attempts>')
    expect(prompt.user).toContain('<recalled_history>')
    expect(prompt.user).toContain('<available_skills>')
    expect(prompt.user).toContain('<correction_hint>')
    expect(prompt.user).toContain('优先参考资料：')
    expect(prompt.system).toContain('<principles>')
    expect(prompt.system).toContain('<decision_contract>')
    expect(prompt.system).toContain('<stable_memory_contract>')
    expect(prompt.system).toContain('<output_contract>')
    expect(prompt.system).toContain('<output_shape>')
    expect(prompt.system).not.toContain('<node_topology>')
    expect(prompt.system).not.toContain('<role>')
    expect(prompt.system).not.toContain('<working_style>')
    expect(prompt.system).not.toContain('<autonomy_principles>')
    expect(prompt.system).not.toContain('<output_rules>')
    expect(prompt.system).not.toContain('<stable_memory_guidance>')
    expect(prompt.system).toContain('如果结果仍依赖未来的工具动作才能完成，readyToDeliver 必须为 false')
    expect(prompt.system).toContain('updatedStableMemory?')
    expect(prompt.system).toContain('toolUsePlan')
    expect(prompt.system).toContain('currentUnderstanding')
    expect(prompt.system).toContain('目标或目标产物、当前阶段、当前策略')
    expect(prompt.user).not.toContain('<confirmed_memory>')
    expect(prompt.user).not.toContain('<recent_learning_outcome>')
    expect(prompt.user).toContain('history-recall')
    expect(prompt.user).toContain('决策了什么：')
    expect(prompt.user).toContain('结果是什么：')
  })

  it('renders default workspace scope as available even when no explicit references are selected', () => {
    const state = createInitialHumanState({
      taskId: 'task-reference-scope',
      userInput: '按当前工作区资料回答这个问题'
    })

    const prompt = buildBrainPrompt({
      state,
      ctx: createStubAiRunContext(
        buildReferenceScope({
          workspace: {
            workspaceId: 'workspace-1',
            workspaceName: 'workspace',
            rootPath: '/tmp/workspace-root'
          },
          selectedReferences: []
        })
      )
    })

    expect(prompt.user).toContain('<reference_scope>')
    expect(prompt.user).toContain('当前用户未显式指定优先参考资料。')
    expect(prompt.user).toContain('当前应先使用默认范围，而不要把这理解成无资料可查。')
    expect(prompt.user).toContain('当前没有可直接缩圈的 kbDocumentIds。')
    expect(prompt.user).toContain('不表示默认知识库范围不可用。')
  })

  it('renders full schema and examples only for currently callable tools', () => {
    const state = {
      ...createInitialHumanState({
        taskId: 'task-tool-schema-prompt',
        userInput: '请准备编辑 docx'
      }),
      skills: {
        learnedSkillIds: ['docx-read', 'docx-write']
      }
    }

    const prompt = buildBrainPrompt({
      state,
      ctx: createStubAiRunContext(
        buildReferenceScope({
          workspace: {
            workspaceId: 'workspace-1',
            workspaceName: 'workspace',
            rootPath: '/tmp/workspace-root'
          }
        })
      )
    })

    expect(prompt.user).toContain('- 工具 docx_heading_edit')
    expect(prompt.user).toContain('输入结构：')
    expect(prompt.user).toContain('insert_after')
    expect(prompt.user).toContain('anchorBlockId')
    expect(prompt.user).toContain('level')
    expect(prompt.user).toContain('rows')
    expect(prompt.user).toContain('示例：')
    expect(prompt.user).toContain('反走样与过拟合对照')
    expect(prompt.user).not.toContain('- 工具 workspace_run_command')
    expect(prompt.user).not.toContain('可提供工具=[')
  })

  it('preserves the raw diagnostic message in rendered recent progress', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-history-diagnostic',
      userInput: '继续修正 docx 参数'
    })

    const state = {
      ...initialState,
      memory: {
        ...initialState.memory,
        history: appendRoundRecord({
          state: initialState,
          decision: buildDecision({
            summary: '重试 docx_text_edit',
            reason: '需要根据失败信息修正参数',
            expectedOutcome: '拿到原始 schema 报错并继续收敛',
            nextAction: {
              action: 'hand',
              toolUsePlan: {
                mode: 'serial',
                calls: [
                  {
                    toolName: 'docx_text_edit',
                    args: {
                      sourcePath: 'weekly-risk.docx',
                      query: ''
                    }
                  }
                ]
              }
            }
          }),
          execution: buildHandExecution({
            toolUsePlan: {
              mode: 'serial',
              calls: [
                {
                  toolName: 'docx_text_edit',
                  args: {
                    sourcePath: 'weekly-risk.docx',
                    query: ''
                  }
                }
              ]
            },
            toolResults: [
              {
                toolName: 'docx_text_edit',
                ok: false,
                code: 'invalid_input',
                data: {
                  ok: false,
                  code: 'invalid_input',
                  error:
                    'Received tool input did not match expected schema ✖ Invalid input → at query'
                },
                diagnostic: {
                  message:
                    'Received tool input did not match expected schema ✖ Invalid input → at query'
                }
              }
            ]
          }),
          createdAt: 1
        })
      }
    }

    const prompt = buildBrainPrompt({
      state,
      ctx: createStubAiRunContext(
        buildReferenceScope({
          workspace: {
            workspaceId: 'workspace-1',
            workspaceName: 'workspace',
            rootPath: '/tmp/workspace-root'
          }
        })
      )
    })

    expect(prompt.user).toContain(
      'diagnostic=Received tool input did not match expected schema ✖ Invalid input → at query'
    )
  })

  it('renders complete docx_read blocks from raw history data into brain prompt', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-docx-history-prompt',
      userInput: '说明反走样的成因和处理方法'
    })

    const state = {
      ...initialState,
      memory: {
        ...initialState.memory,
        history: appendRoundRecord({
          state: initialState,
          decision: buildDecision({
            summary: '读取图形学文档区间',
            reason: '需要完整读取反走样段落',
            expectedOutcome: '拿到定义、成因和处理方法',
            nextAction: {
              action: 'hand',
              toolUsePlan: {
                mode: 'serial',
                calls: [
                  {
                    toolName: 'docx_read',
                    args: {
                      sourcePath: 'graphics.docx',
                      fromBlockId: 'b:19',
                      toBlockId: 'b:26'
                    }
                  }
                ]
              }
            }
          }),
          execution: buildHandExecution({
            toolUsePlan: {
              mode: 'serial',
              calls: [
                {
                  toolName: 'docx_read',
                  args: {
                    sourcePath: 'graphics.docx',
                    fromBlockId: 'b:19',
                    toBlockId: 'b:26'
                  }
                }
              ]
            },
            toolResults: [
              {
                toolName: 'docx_read',
                ok: true,
                code: 'ok',
                data: {
                  ok: true,
                  code: 'ok',
                  sourcePath: 'graphics.docx',
                  currentVersionRef: 'v3',
                  fromBlockId: 'b:19',
                  toBlockId: 'b:26',
                  returnedBlockCount: 4,
                  blocks: [
                    {
                      blockId: 'b:19',
                      type: 'paragraph',
                      bodyIndex: 19,
                      text: '反走样'
                    },
                    {
                      blockId: 'b:20',
                      type: 'paragraph',
                      bodyIndex: 20,
                      text: '走样原因是由于采样频率低于信号频率。'
                    },
                    {
                      blockId: 'b:23',
                      type: 'paragraph',
                      bodyIndex: 23,
                      text: '通过模拟一个像素内多个像素点。'
                    },
                    {
                      blockId: 'b:25',
                      type: 'paragraph',
                      bodyIndex: 25,
                      text: '进行低通滤波，过滤掉高频信号，以达到反走样。'
                    }
                  ]
                }
              }
            ]
          }),
          createdAt: 3
        })
      }
    }

    const prompt = buildBrainPrompt({
      state,
      ctx: createStubAiRunContext(
        buildReferenceScope({
          workspace: {
            workspaceId: 'workspace-1',
            workspaceName: 'workspace',
            rootPath: '/tmp/workspace-root'
          }
        })
      )
    })

    expect(prompt.user).toContain('多个像素点')
    expect(prompt.user).toContain('低通滤波')
    expect(prompt.user).toContain('graphics.docx')
  })
})
