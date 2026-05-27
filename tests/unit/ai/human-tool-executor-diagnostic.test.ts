import { describe, expect, it } from 'vitest'
import type { AiRunContext } from '../../../src/main/services/ai/types'
import { executeToolCall } from '../../../src/main/services/ai/human/node/handNode/toolExecutor'
import type { HumanRuntimeCache } from '../../../src/main/services/ai/human/types'

const createStubAiRunContext = (): AiRunContext => ({
  runId: 'run-tool-diagnostic',
  referenceScope: {
    workspace: {
      workspaceId: 'workspace-1',
      workspaceName: 'workspace',
      rootPath: '/tmp/workspace-root'
    },
    selectedReferences: [],
    hasExplicitSelectedReferences: false,
    hasDirectDocumentNarrowing: false,
    defaultKnowledgeScope: 'current_workspace'
  },
  workspace: {
    workspaceId: 'workspace-1',
    workspaceName: 'workspace',
    rootPath: '/tmp/workspace-root'
  },
  checkCancelled: () => {},
  chatStructured: async () => {
    throw new Error('chatStructured should not be called in tool executor unit tests')
  },
  chatText: async () => {
    throw new Error('chatText should not be called in tool executor unit tests')
  },
  sendEvent: () => {},
  requestApproval: async () => ({
    approved: false
  }),
  loadConversationContext: async () => ({
    recentTurnsText: '',
    conversationSummaryText: ''
  }),
  loadConversationMemory: async () => null,
  trackDocxOpen: () => {},
  trackDocxChanges: () => {},
  resolveDocxOpenTarget: async () => {
    throw new Error('resolveDocxOpenTarget should not be called in tool executor unit tests')
  },
  documentsStore: undefined as never,
  embeddingService: undefined as never
})

const createRuntimeCache = (): HumanRuntimeCache => ({
  familyToolsets: {},
  skillToolsets: {},
  toolCallCount: 0
})

describe('ai unit human tool executor diagnostic', () => {
  it('preserves the raw schema validation message in diagnostic.message', async () => {
    const result = await executeToolCall({
      ctx: createStubAiRunContext(),
      cache: createRuntimeCache(),
      taskId: 'task-tool-diagnostic',
      learnedSkillIds: [],
      toolName: 'terminal_run',
      args: {}
    })

    expect(result.ok).toBe(false)
    expect(result.diagnostic?.message).toBeTruthy()
    expect(result.diagnostic?.message).toContain('command')
    expect(result.diagnostic?.message).not.toContain('missingArgs')
  })
})
