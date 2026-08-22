import { describe, expect, it } from 'vitest'
import { createBrainNode } from '../../../../src/main/services/ai/human/node/brainNode'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import { isContentSafetyError } from '../../../../src/main/services/ai/utils/runFailure'
import { LlmOutputError, LlmProviderError } from '../../../../src/main/services/ai/errors'
import type { AiRunContext } from '../../../../src/main/services/ai/types'

const createBrainContext = (error: Error): AiRunContext =>
  ({
    runId: 'brain-safety-run',
    sessionId: 'brain-safety-session',
    runStartedAt: 0,
    platform: 'macos',
    preference: 'default',
    referenceScope: {
      workspace: { workspaceId: 'ws-1', workspaceName: 'Workspace', rootPath: '/tmp/workspace' },
      selectedReferences: []
    },
    workspace: { workspaceId: 'ws-1', workspaceName: 'Workspace', rootPath: '/tmp/workspace' },
    checkCancelled: () => undefined,
    chatTools: async () => {
      throw error
    },
    loadTranscript: async () => [],
    appendTranscript: async () => undefined,
    sendEvent: () => undefined
  }) as AiRunContext

describe('ai content safety finalization', () => {
  it('recognizes provider content-safety failures without treating every 400 as safety', () => {
    expect(
      isContentSafetyError(
        new Error(
          'structured_output_failed; reason=400 Input data may contain inappropriate content; code=inappropriate-content'
        )
      )
    ).toBe(true)
    expect(
      isContentSafetyError(new Error('structured_output_failed; reason=400 invalid request'))
    ).toBe(false)
  })

  it('routes a brain content-safety failure directly to mouth with delivery guidance', async () => {
    const ctx = createBrainContext(
      new Error(
        'reason=400 Input data may contain inappropriate content; code=inappropriate-content'
      )
    )
    const node = createBrainNode({ ctx, cache: createHumanRuntimeCache() })
    const state = createInitialHumanState({ taskId: 'brain-safety', userInput: 'continue' })
    state.memory.plan = [{ title: 'unfinished item', status: 'todo' }]

    const result = await node(state)

    expect(result.execution.stage).toBe('mouth')
    expect(result.execution.finalizationReason).toBe('brain_content_safety')
    expect(result.execution.pendingRound?.nextAction.action).toBe('mouth')
    expect(result.execution.deliveryGuidanceItems).toEqual([
      expect.objectContaining({ source: 'brain', text: expect.stringContaining('内容安全') })
    ])
  })

  it('keeps an unrelated brain failure on the existing error path', async () => {
    const node = createBrainNode({
      ctx: createBrainContext(new Error('provider authentication failed')),
      cache: createHumanRuntimeCache()
    })
    const state = createInitialHumanState({ taskId: 'brain-error', userInput: 'continue' })

    await expect(node(state)).rejects.toThrow('provider authentication failed')
  })

  it('does not route provider request failures into the fault node', async () => {
    const providerError = new LlmProviderError({
      message: 'The selected model is not activated',
      httpStatus: 404,
      providerCode: 'ModelNotOpen'
    })
    const node = createBrainNode({
      ctx: createBrainContext(providerError),
      cache: createHumanRuntimeCache()
    })
    const state = createInitialHumanState({ taskId: 'brain-provider-error', userInput: 'continue' })

    await expect(node(state)).rejects.toBe(providerError)
  })

  it('propagates invalid output errors from the provider without routing to a stage', async () => {
    const outputError = new LlmOutputError({
      message: '模型返回内容不符合要求的结构。',
      issues: [{ path: 'nextAction', message: 'Required' }]
    })
    const node = createBrainNode({
      ctx: createBrainContext(outputError),
      cache: createHumanRuntimeCache()
    })
    const state = createInitialHumanState({ taskId: 'brain-output-error', userInput: 'continue' })

    await expect(node(state)).rejects.toBe(outputError)
  })
})
