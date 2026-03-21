import { describe, expect, it, vi } from 'vitest'
import { createIntentNode } from '../../../../../src/main/services/ai/main/node/intentNode'
import type { AiRunContext, AiRunState } from '../../../../../src/main/services/ai/types'

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
    loadHistory: vi.fn(async () => ({
      recentTurnsText: 'user: 继续刚才的任务',
      sessionSummaryText: '上一轮停在资料确认阶段'
    })),
    trackDocxOpen: vi.fn(),
    trackDocxChanges: vi.fn(),
    trackDocxPreview: vi.fn(),
    getModelConfig: vi.fn(),
    documentsStore: {} as AiRunContext['documentsStore'],
    embeddingService: {} as AiRunContext['embeddingService']
  }) as AiRunContext

const createBaseState = (): AiRunState => ({
  runId: 'run-1',
  sessionId: 'session-1',
  status: 'running',
  input: '请继续处理当前任务。',
  mainStage: 'main_intent',
  contextRounds: 0,
  contextEvidence: ['证据一', '证据二'],
  plan: [],
  dispatchCursor: 0,
  finalArtifacts: []
})

describe('main intent context evidence alignment', () => {
  it('keeps contextEvidence clean when routing to need_context', async () => {
    const node = createIntentNode({
      ctx: createCtx(async () => ({
        mode: 'need_context',
        reason: '缺少当前指代对象，需要先补充上下文。'
      }))
    })

    const output = await node(createBaseState())

    expect(output.mainStage).toBe('main_context_human')
    expect(output.contextObjective).toBe('缺少当前指代对象，需要先补充上下文。')
    expect(output.contextEvidence).toBeUndefined()
  })

  it('does not persist direct_human route reasons into contextEvidence', async () => {
    const node = createIntentNode({
      ctx: createCtx(async () => ({
        mode: 'direct_human',
        reason: '当前信息已经足够直接完成。'
      }))
    })

    const output = await node(createBaseState())

    expect(output.mainStage).toBe('main_direct_human_exec')
    expect(output.contextEvidence).toBeUndefined()
  })

  it('does not persist to_plan route reasons into contextEvidence', async () => {
    const node = createIntentNode({
      ctx: createCtx(async () => ({
        mode: 'to_plan',
        reason: '任务包含多步依赖，需要拆分计划。'
      }))
    })

    const output = await node(createBaseState())

    expect(output.mainStage).toBe('main_plan')
    expect(output.contextEvidence).toBeUndefined()
  })
})
