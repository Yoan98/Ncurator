import { describe, expect, it } from 'vitest'
import type { AiRunContext } from '../../../src/main/services/ai/types'
import {
  appendRoundRecord,
  buildHandExecution,
  buildLearningExecution
} from '../../../src/main/services/ai/human/memory/roundHistory'
import { buildBrainPromptContext } from '../../../src/main/services/ai/human/prompts/brain'
import { buildReferenceScope } from '../../../src/main/services/ai/prompts/referenceScope'
import { createInitialHumanState } from '../../../src/main/services/ai/human/state/schema'
import type { LastBrainDecision } from '../../../src/main/services/ai/human/types'

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
  nextAction: LastBrainDecision['nextAction']
}): LastBrainDecision => ({
  memoryOps: [],
  decision: {
    summary: input.summary,
    reason: input.reason,
    expectedOutcome: input.expectedOutcome
  },
  readyToDeliver: false,
  nextAction: input.nextAction
})

describe('ai unit brain prompt history blocks', () => {
  it('renders the new history-based brain prompt blocks and removes recent_* sections', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-history-prompt',
      userInput: '请继续推进这个任务'
    })

    const withLearningRound = {
      ...initialState,
      brainMemory: {
        ...initialState.brainMemory,
        outside: {
          ...initialState.brainMemory.outside,
          learnedSkillIds: ['workspace-cli']
        }
      },
      processMemory: appendRoundRecord({
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

    const withHandRound = {
      ...withLearningRound,
      processMemory: appendRoundRecord({
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
                  toolName: 'terminal_run_command',
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
                toolName: 'terminal_run_command',
                args: {
                  command: 'pwd'
                }
              }
            ]
          },
          toolResults: [
            {
              toolName: 'terminal_run_command',
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
      })
    }

    const state = {
      ...withHandRound,
      processMemory: {
        ...withHandRound.processMemory,
        loadedHistoryContext: {
          filters: {
            executionKinds: ['learning'],
            limit: 1
          },
          rounds: [withHandRound.processMemory.roundHistory[0]]
        }
      }
    }
    const prompt = buildBrainPromptContext({
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
    expect(prompt.user).toContain('<confirmed_memory>')
    expect(prompt.user).toContain('<current_capabilities>')
    expect(prompt.user).toContain('<recent_focus>')
    expect(prompt.user).toContain('<earlier_history>')
    expect(prompt.user).toContain('<expanded_history>')
    expect(prompt.user).toContain('<correction_hint>')
    expect(prompt.user).not.toContain('<recent_learning_outcome>')
    expect(prompt.user).not.toContain('<recent_tool_results>')
    expect(prompt.user).not.toContain('<recent_decision_history>')
    expect(prompt.user).toContain('优先参考资料：')
    expect(prompt.system).toContain('<input_use_rules>')
    expect(prompt.system).toContain('<action_contract>')
    expect(prompt.system).not.toContain('human graph')
    expect(prompt.system).not.toContain('<node_topology>')
    expect(prompt.user).toContain('history-recall')
    expect(prompt.user).toContain('决策了什么：')
    expect(prompt.user).toContain('做了什么：')
    expect(prompt.user).toContain('结果是什么：')
  })

  it('renders default workspace scope as available even when no explicit references are selected', () => {
    const state = createInitialHumanState({
      taskId: 'task-reference-scope',
      userInput: '按当前工作区资料回答这个问题'
    })

    const prompt = buildBrainPromptContext({
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
})
