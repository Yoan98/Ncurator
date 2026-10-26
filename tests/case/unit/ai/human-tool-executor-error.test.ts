import { describe, expect, it } from 'vitest'
import type { AiRunContext } from '../../../../src/main/services/ai/types'
import { executeToolCall } from '../../../../src/main/services/ai/human/node/handNode/toolExecutor'
import type { HumanRuntimeCache } from '../../../../src/main/services/ai/human/types'
import { tool } from '@langchain/core/tools'
import { z } from 'zod/v4'

const createStubAiRunContext = (): AiRunContext =>
  ({
    runId: 'run-tool-error',
    partnerId: 'partner-tool-error',
    partnerName: '测试伙伴',
    workspaceRoots: ['/tmp/workspace-root'],
    runStartedAt: 0,
    platform: 'macos',
    preference: 'default',
    executionPermission: 'review',
    referenceScope: {
      selectedReferences: [],
      attachments: []
    },
    checkCancelled: () => {},
    chatStructured: async () => {
      throw new Error('chatStructured should not be called in tool executor unit tests')
    },
    chatText: async () => {
      throw new Error('chatText should not be called in tool executor unit tests')
    },
    sendEvent: () => {},
    requestApprovalBatch: async () => ({ accepted: true, decisions: [] }),
    loadMessageLog: async () => [],
    appendMessageLog: async () => undefined,
    trackDocxOpen: async () => {},
    trackDocxChanges: () => {},
    resolveDocxOpenTarget: async () => {
      throw new Error('resolveDocxOpenTarget should not be called in tool executor unit tests')
    },
    beginDocxApplyRun: () => {},
    applyDocxRunEdits: async () => [],
    discardDocxApplyRun: () => {},
    documentsStore: undefined as never,
    embeddingService: undefined as never
  }) as AiRunContext

const createRuntimeCache = (): HumanRuntimeCache => ({
  familyToolsets: {},
  toolsetTools: {},
  toolCallCount: 0
})

describe('ai unit human tool executor error', () => {
  it('preserves the raw schema validation message in data.error', async () => {
    const result = await executeToolCall({
      ctx: createStubAiRunContext(),
      cache: createRuntimeCache(),
      taskId: 'task-tool-error',
      loadedToolsetIds: [],
      toolName: 'terminal_run',
      toolCallId: 'schema-error',
      args: {}
    })

    expect(result.ok).toBe(false)
    expect(result.data.error).toBeTruthy()
    expect(result.data.error).toContain('command')
    expect(result.data.error).not.toContain('missingArgs')
    expect(result).not.toHaveProperty('diagnostic')
  })

  it.each([
    {
      label: 'Unicode error',
      failure: new Error('原始执行异常：/文档/周报.docx'),
      expected: '原始执行异常：/文档/周报.docx'
    },
    {
      label: 'message object',
      failure: { message: 'ETIMEDOUT: request timed out' },
      expected: 'ETIMEDOUT: request timed out'
    },
    { label: 'empty Error', failure: new Error(''), expected: 'Tool terminal_run failed.' },
    { label: 'unknown object', failure: { other: true }, expected: 'Tool terminal_run failed.' }
  ])(
    'preserves execution failure details or falls back only when empty: $label',
    async ({ failure, expected }) => {
      const cache = createRuntimeCache()
      cache.toolsetTools.terminal = [
        tool(
          async () => {
            throw failure
          },
          { name: 'terminal_run', description: 'unit failure', schema: z.object({}) }
        )
      ]
      const result = await executeToolCall({
        ctx: createStubAiRunContext(),
        cache,
        taskId: 'failure',
        loadedToolsetIds: [],
        toolName: 'terminal_run',
        toolCallId: 'failure',
        args: {}
      })
      expect(result).toMatchObject({ ok: false, data: { error: expected } })
    }
  )

  it('does not treat an explicitly empty error payload as success', async () => {
    const cache = createRuntimeCache()
    cache.toolsetTools.terminal = [
      tool(async () => ({ error: '' }), {
        name: 'terminal_run',
        description: 'unit empty failure',
        schema: z.object({})
      })
    ]
    const result = await executeToolCall({
      ctx: createStubAiRunContext(),
      cache,
      taskId: 'empty',
      loadedToolsetIds: [],
      toolName: 'terminal_run',
      toolCallId: 'empty',
      args: {}
    })
    expect(result).toMatchObject({ ok: false, data: { error: 'Tool terminal_run failed.' } })
  })

  it('propagates cancellation rather than turning it into a tool failure', async () => {
    const cache = createRuntimeCache()
    const cancelled = Object.assign(new Error('cancelled'), { code: 'CANCELLED' })
    cache.toolsetTools.terminal = [
      tool(
        async () => {
          throw cancelled
        },
        { name: 'terminal_run', description: 'unit cancellation', schema: z.object({}) }
      )
    ]
    await expect(
      executeToolCall({
        ctx: createStubAiRunContext(),
        cache,
        taskId: 'cancelled',
        loadedToolsetIds: [],
        toolName: 'terminal_run',
        toolCallId: 'cancelled',
        args: {}
      })
    ).rejects.toBe(cancelled)
  })
})
