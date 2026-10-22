import { describe, expect, it } from 'vitest'
import type { AiRunContext } from '../../../../src/main/services/ai/types'
import { executeToolCall } from '../../../../src/main/services/ai/human/node/handNode/toolExecutor'
import type { HumanRuntimeCache } from '../../../../src/main/services/ai/human/types'

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
      args: {}
    })

    expect(result.ok).toBe(false)
    expect(result.data.error).toBeTruthy()
    expect(result.data.error).toContain('command')
    expect(result.data.error).not.toContain('missingArgs')
    expect(result).not.toHaveProperty('diagnostic')
  })
})
