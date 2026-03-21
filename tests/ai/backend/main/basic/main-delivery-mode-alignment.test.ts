import { describe, expect, it, vi } from 'vitest'
import { createContextEnrichNode } from '../../../../../src/main/services/ai/main/node/contextEnrichNode'
import { createDirectHumanExecNode } from '../../../../../src/main/services/ai/main/node/directHumanExecNode'
import { createPlanExecNode } from '../../../../../src/main/services/ai/main/node/planExecNode'
import { createSynthesisHumanNode } from '../../../../../src/main/services/ai/main/node/synthesisHumanNode'
import type { AiRunContext, AiRunState, HumanTaskRunner } from '../../../../../src/main/services/ai/types'

const createCtx = (): AiRunContext =>
  ({
    runId: 'run-1',
    sessionId: 'session-1',
    selectedScopeSummary: 'workspace:test-workspace',
    allowNonLocal: false,
    runtimeSettings: {},
    checkCancelled: () => undefined,
    chatStructured: vi.fn(),
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

const createBaseState = (): AiRunState => ({
  runId: 'run-1',
  sessionId: 'session-1',
  status: 'running',
  input: '请处理当前任务。',
  mainStage: 'main_direct_human_exec',
  contextRounds: 0,
  contextObjective: '请补充上下文。',
  contextEvidence: [],
  plan: [
    {
      id: 'task-1',
      title: '核对现状',
      userInput: '检查当前状态。',
      status: 'ready'
    }
  ],
  dispatchCursor: 0
})

describe('main delivery mode alignment', () => {
  it('passes user_answer mode to direct and synthesis human dispatch', async () => {
    const directModes: Array<string | undefined> = []
    const synthesisModes: Array<string | undefined> = []
    const directRunner: HumanTaskRunner = async (_task, options) => {
      directModes.push(options?.deliveryMode)
      return {
        taskId: 'direct-human',
        status: 'completed',
        summary: '已直接回答。',
        deliveryMarkdown: '# Direct Delivery'
      }
    }
    const synthesisRunner: HumanTaskRunner = async (_task, options) => {
      synthesisModes.push(options?.deliveryMode)
      return {
        taskId: 'synthesis-human',
        status: 'completed',
        summary: '已汇总。',
        deliveryMarkdown: '# Synthesis Delivery'
      }
    }

    await createDirectHumanExecNode({ ctx: createCtx(), runHumanTask: directRunner })(createBaseState())
    await createSynthesisHumanNode({
      ctx: createCtx(),
      runHumanTask: synthesisRunner
    })({
      ...createBaseState(),
      mainStage: 'main_synthesis_human'
    })

    expect(directModes).toEqual(['user_answer'])
    expect(synthesisModes).toEqual(['user_answer'])
  })

  it('passes task_handoff mode to plan_exec dispatch', async () => {
    const deliveryModes: Array<string | undefined> = []
    const runHumanTask: HumanTaskRunner = async (_task, options) => {
      deliveryModes.push(options?.deliveryMode)
      return {
        taskId: 'task-1',
        status: 'completed',
        summary: '已完成子任务。',
        deliveryMarkdown: '# 子任务交付'
      }
    }

    await createPlanExecNode({ ctx: createCtx(), runHumanTask })(createBaseState())

    expect(deliveryModes).toEqual(['task_handoff'])
  })

  it('passes context_note mode and only extracts reusable evidence section', async () => {
    const deliveryModes: Array<string | undefined> = []
    const runHumanTask: HumanTaskRunner = async (_task, options) => {
      deliveryModes.push(options?.deliveryMode)
      return {
        taskId: 'context-1',
        status: 'completed',
        summary: '已补充上下文。',
        deliveryMarkdown: [
          '# 上下文补充结果',
          '',
          '## 当前状态',
          'completed',
          '',
          '## 可复用证据',
          '- 证据一',
          '1. 证据二',
          '',
          '## 当前边界',
          '- 不应进入 contextEvidence 的正文'
        ].join('\n')
      }
    }

    const output = await createContextEnrichNode({ ctx: createCtx(), runHumanTask })(createBaseState())

    expect(deliveryModes).toEqual(['context_note'])
    expect(output.contextEvidence).toEqual(['证据一', '证据二'])
  })

  it('falls back to summary when context_note has no reusable evidence section', async () => {
    const runHumanTask: HumanTaskRunner = async () => ({
      taskId: 'context-1',
      status: 'completed',
      summary: '只保留 summary 作为上下文证据。',
      deliveryMarkdown: '# 上下文补充结果\n\n## 可复用证据\n无'
    })

    const output = await createContextEnrichNode({ ctx: createCtx(), runHumanTask })(createBaseState())

    expect(output.contextEvidence).toEqual(['只保留 summary 作为上下文证据。'])
  })

  it('falls back to summary when context_note misses reusable evidence section entirely', async () => {
    const runHumanTask: HumanTaskRunner = async () => ({
      taskId: 'context-1',
      status: 'completed',
      summary: '缺少可复用证据章节时使用 summary。',
      deliveryMarkdown: '# 上下文补充结果\n\n## 当前状态\ncompleted'
    })

    const output = await createContextEnrichNode({ ctx: createCtx(), runHumanTask })(createBaseState())

    expect(output.contextEvidence).toEqual(['缺少可复用证据章节时使用 summary。'])
  })
})
