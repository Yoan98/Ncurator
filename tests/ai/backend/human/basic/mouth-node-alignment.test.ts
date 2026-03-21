import { describe, expect, it, vi } from 'vitest'
import { createMouthNode } from '../../../../../src/main/services/ai/human/node/mouthNode'
import type { HumanRuntimeCache, HumanState } from '../../../../../src/main/services/ai/human/types'
import type { AiRunContext } from '../../../../../src/main/services/ai/types'

const createCache = (): HumanRuntimeCache => ({
  familyToolsets: {},
  skillToolsets: {},
  toolCallCount: 0
})

const createState = (status: 'completed' | 'blocked'): HumanState => ({
  task: {
    taskId: 'task-1',
    userInput: '请整理当前任务结果。'
  },
  runtime: {
    stage: 'mouth',
    status: 'running'
  },
  brainMemory: {
    inside: {
      facts: [
        {
          id: 'fact-1',
          summary: '已经完成关键核对。',
          evidenceIds: ['evidence-1']
        }
      ],
      evidences: [
        {
          id: 'evidence-1',
          toolName: 'kb_hybrid_search_chunks',
          summary: '命中 2 条直接证据。',
          sourceType: 'tool_result',
          rawRef: 'tool_result#1'
        }
      ],
      openQuestions: ['是否需要继续补充审批记录？']
    },
    outside: {
      skillCatalog: [],
      learnedSkillIds: [],
      brainDecisions: []
    }
  },
  lastBrainDecision: {
    memoryOps: [],
    decision: {
      summary: status === 'completed' ? '任务可以结束' : '任务当前阻塞',
      reason: '现有状态已经确定。',
      expectedOutcome: status === 'completed' ? '整理交付并结束。' : '说明阻塞并等待恢复条件。'
    },
    nextAction: {
      action: 'mouth',
      status
    }
  },
  trace: {
    steps: []
  }
})

const createCtx = (chatStructured: AiRunContext['chatStructured']): AiRunContext =>
  ({
    runId: 'run-1',
    sessionId: 'session-1',
    selectedScopeSummary: 'workspace:test-workspace',
    allowNonLocal: false,
    runtimeSettings: {},
    checkCancelled: () => undefined,
    chatStructured,
    sendEvent: vi.fn(),
    requestApproval: vi.fn(),
    loadHistory: vi.fn(),
    trackDocxOpen: vi.fn(),
    trackDocxChanges: vi.fn(),
    trackDocxPreview: vi.fn(),
    getModelConfig: vi.fn(),
    documentsStore: {} as AiRunContext['documentsStore'],
    embeddingService: {} as AiRunContext['embeddingService']
  }) as AiRunContext

describe('mouth node alignment', () => {
  it('always uses finalStatus from brain decision even if model payload carries another status', async () => {
    const ctx = createCtx(async () => ({
      summary: '模型输出了总结。',
      deliveryMarkdown: '# 处理结果',
      status: 'blocked'
    }))
    const node = createMouthNode({
      ctx,
      cache: createCache(),
      deliveryMode: 'user_answer',
      streamAnswer: false,
      internalDelivery: false
    })

    const output = await node(createState('completed'))

    expect(output.result?.status).toBe('completed')
    expect(output.runtime.status).toBe('completed')
    expect(output.trace.steps.at(-1)?.action).toBe('deliver_result')
  })

  it('builds deterministic task_handoff markdown when model omits deliveryMarkdown', async () => {
    const ctx = createCtx(async () => ({
      summary: '已完成本子任务。'
    }))
    const node = createMouthNode({
      ctx,
      cache: createCache(),
      deliveryMode: 'task_handoff',
      streamAnswer: false,
      internalDelivery: true
    })

    const output = await node(createState('completed'))
    const deliveryMarkdown = output.result?.deliveryMarkdown || ''

    expect(deliveryMarkdown).toContain('# 子任务交付')
    expect(deliveryMarkdown).toContain('## 任务状态')
    expect(deliveryMarkdown).toContain('## 关键事实')
    expect(deliveryMarkdown).toContain('## 建议下一步')
  })
})
