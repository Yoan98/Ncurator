import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { HumanStepRecord } from '../../../../src/shared/types'
import { createHumanResponseNode } from '../../../../src/main/services/ai/node/human/responseNode'
import type { HumanRunState } from '../../../../src/main/services/ai/node/human/types'
import { createTestAiRunContext } from '../../../harness/main/contextFactory'
import { EventCollector } from '../../../harness/main/eventCollector'

const invokeMock = vi.fn()
const streamMock = vi.fn()

vi.mock('../../../../src/main/services/llm/chatModel', () => ({
  createChatModel: () => ({
    invoke: invokeMock,
    stream: streamMock
  })
}))

const createBaseState = (): HumanRunState => ({
  runId: 'run-human-response',
  input: {
    taskId: 'task-1',
    objective: '请完成当前任务'
  },
  phase: 'response',
  status: 'completed',
  deliveryKind: 'handoff',
  streamAnswer: false,
  internalDelivery: false,
  steps: 2,
  maxSteps: 6,
  availableSkillCards: [],
  loadedSkills: {},
  loadedToolsets: {},
  activeSkillIds: [],
  activeTools: [],
  lastObservation: {
    kind: 'terminal',
    status: 'completed',
    code: 'ok',
    summary: 'terminal summary'
  },
  lastDecision: {
    action: 'complete_task',
    summary: '任务完成',
    rationale: '任务完成',
    publicNarrative: '任务完成'
  },
  stepHistory: [
    {
      step: 1,
      action: 'invoke_tool',
      publicNarrative: '先检索证据',
      activeSkillIds: [],
      activeToolNames: ['kb_hybrid_search_chunks'],
      summary: '已检索到证据'
    },
    {
      step: 2,
      action: 'complete_task',
      publicNarrative: '已经收敛',
      activeSkillIds: [],
      activeToolNames: ['kb_hybrid_search_chunks'],
      resultStatus: 'ok',
      summary: '任务完成'
    }
  ] satisfies HumanStepRecord[],
  summary: '任务完成',
  deliveryMarkdown: '',
  resultCode: 'ok'
})

const createStream = async function* (chunks: string[]) {
  for (const chunk of chunks) {
    yield { content: chunk }
  }
}

describe('human response delivery', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    streamMock.mockReset()
  })

  test('handoff delivery should emit task delivery without answer stream', async () => {
    invokeMock.mockResolvedValue({
      content: '# 子任务交付\n\n## 已完成\n任务完成\n\n## 建议后续步骤\n继续下一步'
    })
    const eventCollector = new EventCollector()
    const ctx = createTestAiRunContext({
      runId: 'run-handoff',
      workspaceRootPath: process.cwd(),
      eventCollector,
      liveModelConfig: {
        id: 'mock-model',
        name: 'mock-model',
        base_url: 'https://example.com/v1',
        model_name: 'mock-model',
        api_key: 'mock-key',
        is_active: true
      }
    })

    const node = createHumanResponseNode({ ctx })
    const result = await node(createBaseState())

    expect(result.deliveryMarkdown).toContain('# 子任务交付')
    expect(result.localSourceStatus).toBe('used')
    expect(eventCollector.snapshot().map((event) => event.type)).toEqual(['task_delivery_ready'])
  })

  test('final delivery should stream answer tokens and emit completion plus task delivery', async () => {
    streamMock.mockResolvedValue(
      createStream(['# 最终答复\n\n', '## 结论\n已完成最终输出'])
    )
    const eventCollector = new EventCollector()
    const ctx = createTestAiRunContext({
      runId: 'run-final',
      workspaceRootPath: process.cwd(),
      eventCollector,
      liveModelConfig: {
        id: 'mock-model',
        name: 'mock-model',
        base_url: 'https://example.com/v1',
        model_name: 'mock-model',
        api_key: 'mock-key',
        is_active: true
      }
    })

    const node = createHumanResponseNode({ ctx })
    const result = await node({
      ...createBaseState(),
      input: {
        taskId: 'synthesis-human',
        objective: '请基于全部任务交付生成最终答复'
      },
      deliveryKind: 'final',
      streamAnswer: true
    })

    expect(result.deliveryMarkdown).toContain('# 最终答复')
    expect(result.localSourceStatus).toBe('used')
    expect(eventCollector.snapshot().map((event) => event.type)).toEqual([
      'answer_token',
      'answer_token',
      'answer_completed',
      'task_delivery_ready'
    ])
  })
})
