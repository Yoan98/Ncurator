import { describe, expect, it } from 'vitest'
import type { AiRunContext } from '../../../src/main/services/ai/types'
import { buildBrainPrompt } from '../../../src/main/services/ai/human/prompts/brain'
import { humanDecisionSchema } from '../../../src/main/services/ai/human/schema'
import { createInitialHumanState } from '../../../src/main/services/ai/human/state/schema'
import {
  countActiveToolNamesForSkillIds,
  fitSkillIdsToToolBudget
} from '../../../src/main/services/ai/human/node/learningNode/toolBudget'
import { buildReferenceScope } from '../../../src/main/services/ai/prompts/referenceScope'

type FakeSkillId = 'alpha' | 'beta' | 'gamma' | 'delta' | 'epsilon' | 'zeta'

const FAKE_SKILL_TOOLS: Record<FakeSkillId, readonly string[]> = {
  alpha: ['tool-1', 'tool-2', 'tool-3', 'tool-4', 'tool-5', 'tool-6', 'tool-7', 'tool-8'],
  beta: ['tool-9', 'tool-10', 'tool-11', 'tool-12', 'tool-13', 'tool-14', 'tool-15', 'tool-16'],
  gamma: ['tool-17', 'tool-18', 'tool-19', 'tool-20', 'tool-21'],
  delta: ['tool-22', 'tool-23', 'tool-24', 'tool-25'],
  epsilon: ['tool-26', 'tool-27', 'tool-28', 'tool-29', 'tool-30', 'tool-31', 'tool-32', 'tool-33', 'tool-34', 'tool-35', 'tool-36', 'tool-37'],
  zeta: ['tool-38', 'tool-39', 'tool-40', 'tool-41', 'tool-42', 'tool-43', 'tool-44', 'tool-45', 'tool-46', 'tool-47', 'tool-48', 'tool-49']
}

const getFakeToolNames = (skillId: FakeSkillId): readonly string[] => FAKE_SKILL_TOOLS[skillId]

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

describe('ai unit learning tool budget', () => {
  it('counts unique active tool names across learned skills', () => {
    const count = countActiveToolNamesForSkillIds({
      skillIds: ['alpha', 'alpha', 'beta'],
      getToolNames: getFakeToolNames
    })

    expect(count).toBe(16)
  })

  it('evicts oldest previously learned skills to preserve newly requested skills under tool budget', () => {
    const result = fitSkillIdsToToolBudget({
      existingSkillIds: ['alpha', 'beta', 'gamma'],
      requestedSkillIds: ['delta'],
      maxActiveTools: 20,
      getToolNames: getFakeToolNames
    })

    expect(result).toEqual({
      ok: true,
      learnedSkillIds: ['beta', 'gamma', 'delta'],
      evictedSkillIds: ['alpha'],
      activeToolCount: 17
    })
  })

  it('fails when the newly requested skills alone exceed the active tool budget', () => {
    const result = fitSkillIdsToToolBudget({
      existingSkillIds: ['alpha'],
      requestedSkillIds: ['epsilon', 'zeta'],
      maxActiveTools: 20,
      getToolNames: getFakeToolNames
    })

    expect(result).toEqual({
      ok: false,
      activeToolCount: 24,
      requestedSkillIds: ['epsilon', 'zeta']
    })
  })

  it('allows learning decisions to request three or more skills', () => {
    expect(
      humanDecisionSchema.parse({
        decision: {
          summary: '学习多个技能',
          reason: '测试学习不再受固定数量上限约束',
          expectedOutcome: '应由 active tool budget 决定是否可执行'
        },
        readyToDeliver: false,
        nextAction: {
          action: 'learning',
          wantLearnSkillIds: ['workspace-cli', 'docx-read', 'docx-write']
        }
      })
    ).toMatchObject({
      nextAction: {
        action: 'learning',
        wantLearnSkillIds: ['workspace-cli', 'docx-read', 'docx-write']
      }
    })
  })

  it('mentions the natural-language input and action contracts in the brain prompt', () => {
    const prompt = buildBrainPrompt({
      state: createInitialHumanState({
        taskId: 'task-1',
        userInput: '请继续处理这个任务'
      }),
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
    }).system

    expect(prompt).toContain('<autonomy_principles>')
    expect(prompt).toContain('任务、记忆、技能、历史和提示等不同类型的信息')
    expect(prompt).toContain('参考材料，不是固定流程')
    expect(prompt).toContain('<action_boundaries>')
    expect(prompt).toContain('你只负责判断下一步')
    expect(prompt).toContain('learning 只负责补齐当前真正缺失的技能说明')
    expect(prompt).toContain('<transition_contract>')
    expect(prompt).toContain('nextAction 只能在 learning、hand、mouth 三者中选择其一')
    expect(prompt).toContain('<context_block_guide>')
    expect(prompt).toContain('<output_contract>')
    expect(prompt).toContain('updatedStableMemory')
    expect(prompt).toContain('updatedStableMemory 是可选的 partial patch')
    expect(prompt).toContain('hand.toolUsePlan.calls[*].args')
    expect(prompt).toContain('mouth 只负责整理最终结果，不新增事实，不继续执行工具')
    expect(prompt).not.toContain('<input_use_rules>')
    expect(prompt).not.toContain('<reasoning_rules>')
    expect(prompt).not.toContain('human graph')
    expect(prompt).not.toContain('<node_topology>')
  })
})
