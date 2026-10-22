import { describe, expect, it } from 'vitest'
import type { AiRunContext } from '../../../../src/main/services/ai/types'
import { createToolsetLoadingNode } from '../../../../src/main/services/ai/human/node/toolsetLoadingNode'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { humanNextActionSchema } from '../../../../src/main/services/ai/human/schema'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'

const createStubAiRunContext = (): AiRunContext =>
  ({
    runId: 'run-toolset-loading-unit',
    partnerId: 'partner-toolset-loading-unit',
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
      throw new Error('chatStructured should not be called in toolset loading unit tests')
    },
    chatText: async () => {
      throw new Error('chatText should not be called in toolset loading unit tests')
    },
    sendEvent: () => {},
    requestApprovalBatch: async () => ({ accepted: true, decisions: [] }),
    loadMessageLog: async () => [],
    appendMessageLog: async () => undefined,
    trackDocxOpen: async () => {},
    trackDocxChanges: () => {},
    resolveDocxOpenTarget: async () => {
      throw new Error('resolveDocxOpenTarget should not be called in toolset loading unit tests')
    },
    beginDocxApplyRun: () => {},
    applyDocxRunEdits: async () => [],
    discardDocxApplyRun: () => {},
    documentsStore: undefined as never,
    embeddingService: undefined as never
  }) as AiRunContext

const buildToolsetLoadingDecision = (
  toolsetIds: string[]
): {
  thought: { text: string }
  nextAction: { action: 'toolset_loading'; wantLoadToolsetIds: string[]; toolCallId: string }
} => ({
  thought: {
    text: '测试 toolset loading partial success'
  },
  nextAction: {
    action: 'toolset_loading' as const,
    wantLoadToolsetIds: toolsetIds,
    toolCallId: 'learn-call-1'
  }
})

describe('ai unit toolset loading partial success', () => {
  it('loads new toolsets while skipping duplicates', async () => {
    const ctx = createStubAiRunContext()
    const cache = createHumanRuntimeCache()
    const toolsetLoadingNode = createToolsetLoadingNode({ ctx, cache })
    const baseState = createInitialHumanState({
      taskId: 'task-duplicate-plus-new',
      userInput: '请加载 docx-read 和 docx-write'
    })

    const nextState = await toolsetLoadingNode({
      ...baseState,
      toolsets: {
        loadedToolsetIds: ['docx-read']
      },
      execution: {
        ...baseState.execution,
        pendingRound: buildToolsetLoadingDecision(['docx-read', 'docx-write'])
      }
    })

    expect(nextState.execution.lastToolsetLoadingOutcome).toMatchObject({
      loadedToolsetIds: ['docx-write'],
      skippedDuplicateToolsetIds: ['docx-read'],
      skippedUnknownToolsetIds: []
    })
    expect(nextState.toolsets.loadedToolsetIds).toEqual(['docx-read', 'docx-write'])
    expect(nextState.trace.steps.at(-1)).toMatchObject({
      action: 'load_toolset',
      toolsetId: 'docx-write'
    })
    expect(cache.toolsetTools['docx-write']).toBeTruthy()
  })

  it('loads known toolsets while skipping unknown ones', async () => {
    const ctx = createStubAiRunContext()
    const cache = createHumanRuntimeCache()
    const toolsetLoadingNode = createToolsetLoadingNode({ ctx, cache })
    const baseState = createInitialHumanState({
      taskId: 'task-unknown-plus-new',
      userInput: '请加载 unknown-toolset 和 docx-read'
    })

    const nextState = await toolsetLoadingNode({
      ...baseState,
      execution: {
        ...baseState.execution,
        pendingRound: buildToolsetLoadingDecision(['unknown-toolset', 'docx-read'])
      }
    })

    expect(nextState.execution.lastToolsetLoadingOutcome).toMatchObject({
      loadedToolsetIds: ['docx-read'],
      skippedUnknownToolsetIds: ['unknown-toolset']
    })
    expect(nextState.toolsets.loadedToolsetIds).toEqual(['docx-read'])
    expect(nextState.trace.steps.at(-1)).toMatchObject({
      action: 'load_toolset',
      toolsetId: 'docx-read'
    })
  })

  it('treats builtin-only requests as invalid toolset loading', async () => {
    const ctx = createStubAiRunContext()
    const cache = createHumanRuntimeCache()
    const toolsetLoadingNode = createToolsetLoadingNode({ ctx, cache })
    const baseState = createInitialHumanState({
      taskId: 'task-builtin-only',
      userInput: '请加载 terminal'
    })

    const nextState = await toolsetLoadingNode({
      ...baseState,
      execution: {
        ...baseState.execution,
        pendingRound: buildToolsetLoadingDecision(['terminal'])
      }
    })

    expect(nextState.execution.stage).toBe('dispatch')
    expect(nextState.execution.lastToolsetLoadingOutcome).toMatchObject({
      requestedToolsetIds: ['terminal'],
      loadedToolsetIds: [],
      skippedDuplicateToolsetIds: [],
      skippedUnknownToolsetIds: []
    })
    expect(nextState.toolsets.loadedToolsetIds).toEqual([])
  })

  it('rejects states whose loadedToolsetIds still contain builtin toolsets', async () => {
    const ctx = createStubAiRunContext()
    const cache = createHumanRuntimeCache()
    const toolsetLoadingNode = createToolsetLoadingNode({ ctx, cache })
    const baseState = createInitialHumanState({
      taskId: 'task-invalid-loaded-toolset-state',
      userInput: '请继续任务'
    })

    await expect(
      toolsetLoadingNode({
        ...baseState,
        toolsets: {
          loadedToolsetIds: ['terminal']
        },
        execution: {
          ...baseState.execution,
          pendingRound: buildToolsetLoadingDecision(['docx-read'])
        }
      })
    ).rejects.toThrow('loadedToolsetIds 只允许 external toolset')
  })

  it('allows toolset loading decisions to request three or more toolsets', () => {
    expect(
      humanNextActionSchema.parse({
        action: 'toolset_loading',
        toolCallId: 'call-toolset-loading-budget',
        wantLoadToolsetIds: ['docx-read', 'docx-write', 'pdf-read', 'excel-write']
      })
    ).toMatchObject({
      action: 'toolset_loading',
      wantLoadToolsetIds: ['docx-read', 'docx-write', 'pdf-read', 'excel-write']
    })
  })
})
