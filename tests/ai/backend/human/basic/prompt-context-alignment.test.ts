import { describe, expect, it } from 'vitest'
import { buildBrainPromptContext } from '../../../../../src/main/services/ai/human/node/brainNode/promptContext'
import { buildMouthPromptContext } from '../../../../../src/main/services/ai/human/node/mouthNode/promptContext'
import type { HumanState } from '../../../../../src/main/services/ai/human/types'

const createBaseState = (): HumanState => ({
  task: {
    taskId: 'task-1',
    userInput: '请整理项目风险控制要求。'
  },
  runtime: {
    stage: 'brain',
    status: 'running'
  },
  brainMemory: {
    inside: {
      facts: [
        {
          id: 'fact-1',
          summary: '项目上线前需要执行复核。',
          evidenceIds: ['evidence-1']
        }
      ],
      evidences: [
        {
          id: 'evidence-1',
          toolName: 'kb_hybrid_search_chunks',
          summary: '知识库显示上线前需要复核。',
          sourceType: 'tool_result',
          rawRef: 'tool_result#1'
        }
      ],
      openQuestions: ['是否需要同步更新周报？']
    },
    outside: {
      skillCatalog: [
        {
          skillId: 'kb-evidence-query',
          familyId: 'kb',
          title: 'kb-evidence-query',
          summary: '直接查询 chunk 证据并收敛事实依据。',
          toolNames: ['kb_hybrid_search_chunks', 'kb_vector_search_chunks', 'kb_fts_search_chunks'],
          whenToUse: '当已经知道查询目标，需要直接从本地知识库提取证据时。'
        }
      ],
      learnedSkillIds: ['kb-evidence-query'],
      brainDecisions: [
        {
          createdAt: 1710926460000,
          memoryOps: [],
          decision: {
            summary: '调用 KB 检索获取证据',
            reason: '当前缺少可引用的直接依据。',
            expectedOutcome: '拿到证据后判断是否收敛。'
          },
          nextAction: {
            action: 'hand',
            parallelCallToolParam: [
              {
                toolName: 'kb_hybrid_search_chunks',
                args: {
                  query: '项目风险控制要求'
                }
              }
            ]
          }
        }
      ]
    }
  },
  lastParallelCallToolResults: [
    {
      toolName: 'kb_hybrid_search_chunks',
      ok: true,
      code: 'ok',
      summary: '命中 3 条相关证据。'
    }
  ],
  lastBrainDecision: {
    memoryOps: [],
    decision: {
      summary: '当前已经可以结束任务',
      reason: '现有证据已足够支撑最终结论。',
      expectedOutcome: '由表达节点整理出最终结果。'
    },
    nextAction: {
      action: 'mouth',
      status: 'completed'
    }
  },
  watchHint: '请优先考虑结束或纠偏。',
  runtimeArtifacts: [],
  trace: {
    steps: []
  }
})

describe('prompt context alignment', () => {
  it('builds brain prompt context with text blocks and only keeps structured payload in decision history nextAction', () => {
    const prompt = buildBrainPromptContext(createBaseState())

    expect(prompt.user).toContain('<memory_snapshot>')
    expect(prompt.user).toContain('下面是你之前沉淀下来的记忆。')
    expect(prompt.user).toContain('已确认的事实：')
    expect(prompt.user).toContain('支撑这些事实的关键证据：')
    expect(prompt.user).toContain('仍未解决的问题：')
    expect(prompt.user).toContain('当前可用技能目录摘要：')
    expect(prompt.user).toContain('已学习技能的详细说明：')
    expect(prompt.user).not.toContain('"facts"')
    expect(prompt.user).not.toContain('facts:')
    expect(prompt.user).not.toContain('evidences:')
    expect(prompt.user).not.toContain('openQuestions:')
    expect(prompt.user).not.toContain('catalog:')
    expect(prompt.user).toContain('工具 kb_hybrid_search_chunks 执行成功（code=ok）；摘要：命中 3 条相关证据。')
    expect(prompt.user).not.toContain('"ok":true')
    expect(prompt.user).toContain(
      'nextAction数据：parallelCallToolParam=[{"toolName":"kb_hybrid_search_chunks","args":{"query":"项目风险控制要求"}}]'
    )
    expect(prompt.user).toContain('示例参数键=[queryText, limit]')
    expect(prompt.user).toContain('如果这里是 none，表示当前没有额外的收敛提醒')
  })

  it('builds mouth prompt context without recent decision history', () => {
    const prompt = buildMouthPromptContext({
      state: createBaseState(),
      deliveryMode: 'task_handoff',
      finalStatus: 'completed'
    })

    expect(prompt.user).toContain('<delivery_mode>')
    expect(prompt.user).toContain('task_handoff')
    expect(prompt.user).toContain('<final_decision>')
    expect(prompt.user).toContain('结束状态completed')
    expect(prompt.user).toContain('<open_questions>')
    expect(prompt.user).toContain('是否需要同步更新周报？')
    expect(prompt.user).not.toContain('<recent_decision_history>')
    expect(prompt.user).not.toContain('<recent_tool_outcomes>')
    expect(prompt.user).not.toContain('<delivery_hints>')
  })
})
