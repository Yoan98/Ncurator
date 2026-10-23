import { describe, expect, it } from 'vitest'
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { ChatMessageLogEntry, ChatMessageLogRecord } from '../../../../src/shared/types'
import type { UserSkill } from '../../../../src/shared/userSkills'
import type { AiRunContext } from '../../../../src/main/services/ai/types'
import {
  loadCurrentUserSkills,
  renderUserSkills,
  type UserSkillReader
} from '../../../../src/main/services/ai/human/userSkills'
import { refreshUserSkillContext } from '../../../../src/main/services/ai/human/userSkillContext'
import { MAX_USER_SKILL_BODY_BYTES } from '../../../../src/shared/userSkills'
import { HUMAN_MAX_ACTIVE_TOOLS } from '../../../../src/main/services/ai/human/constants'
import { EXTERNAL_RUNTIME_TOOLSET_IDS } from '../../../../src/main/services/ai/human/toolsets'
import { createHumanGraphRunner } from '../../../../src/main/services/ai/human/graph/humanGraph'
import { createSkillLoadingNode } from '../../../../src/main/services/ai/human/node/skillLoadingNode'
import { createToolsetLoadingNode } from '../../../../src/main/services/ai/human/node/toolsetLoadingNode'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import { projectMessageLogRecords } from '../../../../src/main/services/ai/human/memory/transcript'
import {
  LOAD_SKILL_SCHEMA,
  LOAD_TOOLSET_SCHEMA
} from '../../../../src/main/services/ai/human/tools/agentControl/toolSchemas'

const skill = (id: string): UserSkill => ({
  id,
  name: id.slice(5),
  description: `Description ${id.slice(5)}`,
  directoryName: id.slice(5),
  createdAt: 123
})

// Unit-only reader seam; both production loaders, graph, prompts and log projection are exercised.
const fixture = () => {
  const enabled = new Map<string, string>([
    ['user:b', 'BODY_B'],
    ['user:a', 'BODY_A']
  ])
  const log: ChatMessageLogEntry[] = []
  const reader: UserSkillReader = {
    listEnabled: (partnerId) => (partnerId === 'partner-a' ? [...enabled.keys()].map(skill) : []),
    loadEnabled: (partnerId, id) => {
      const body = enabled.get(id)
      if (partnerId !== 'partner-a' || body === undefined) throw new Error('not enabled')
      return { skill: skill(id), body, resourceBase: `/skills/${id.slice(5)}` }
    }
  }
  const ctx = {
    partnerId: 'partner-a',
    partnerName: 'Partner',
    runId: 'run-a',
    platform: 'macos',
    executionPermission: 'review',
    userSkillService: reader,
    workspaceRoots: ['/tmp'],
    checkCancelled: () => {},
    sendEvent: () => {},
    appendMessageLog: async (entries: ChatMessageLogEntry[]) => {
      log.push(...entries)
    }
  } as AiRunContext
  const cache = createHumanRuntimeCache()
  cache.messages = [new SystemMessage('initial'), new HumanMessage('task')]
  const state = createInitialHumanState({ taskId: 'task-a', userInput: 'task' })
  const loadSkills = (ids: string[], previous = state) =>
    createSkillLoadingNode({ ctx, cache })({
      ...previous,
      execution: {
        ...previous.execution,
        pendingRound: {
          thought: { text: 'load instructions' },
          nextAction: { action: 'skill_loading', wantLoadSkillNames: ids, toolCallId: 'skill-a' }
        }
      }
    })
  const loadToolsets = (ids: string[], previous = state) =>
    createToolsetLoadingNode({ ctx, cache })({
      ...previous,
      execution: {
        ...previous.execution,
        pendingRound: {
          thought: { text: 'load registered tools' },
          nextAction: {
            action: 'toolset_loading',
            wantLoadToolsetIds: ids,
            toolCallId: 'toolset-a'
          }
        }
      }
    })
  return { enabled, log, reader, ctx, cache, state, loadSkills, loadToolsets }
}

const graphFixture = (steps: Array<{ name: string; args: Record<string, string[]> }> = []) => {
  const f = fixture()
  const records: ChatMessageLogRecord[] = []
  const calls: Array<{ text: string; system: string; tools: string[] }> = []
  const compactionInputs: string[] = []
  const ctx: AiRunContext = {
    ...f.ctx,
    platform: 'macos',
    preference: 'default',
    runStartedAt: 0,
    userMessageId: 'user-run-1',
    referenceScope: { selectedReferences: [], attachments: [] },
    hasPendingUserMessages: () => false,
    waitForPendingUserMessageSubmissions: async () => {},
    listFileChangeRecords: async () => [],
    loadMessageLog: async () => [...records],
    appendMessageLog: async (entries) => {
      for (const entry of entries) {
        const seq = records.length + 1
        records.push({
          id: `log-${seq}`,
          partnerId: ctx.partnerId,
          runId: ctx.runId,
          seq,
          entry,
          createdAt: seq
        })
      }
    },
    chatText: async (request) => {
      compactionInputs.push(request.user)
      return 'History summarized; continue the current task.'
    },
    chatTools: async (request) => {
      calls.push({
        text: request.messages.map((message) => String(message.content)).join('\n'),
        system: String(request.messages[0].content),
        tools: request.tools.map((tool) => tool.name)
      })
      const step = steps[calls.length - 1]
      if (step) {
        return {
          message: new AIMessage({
            content: '',
            tool_calls: [
              {
                id: `load-${calls.length}`,
                name: step.name,
                args: step.args,
                type: 'tool_call'
              }
            ]
          }),
          finishReason: 'tool_calls'
        }
      }
      return { message: new AIMessage('Task complete.'), finishReason: 'stop' }
    }
  }
  const run = async (number: number) => {
    ctx.runId = `run-${number}`
    ctx.userMessageId = `user-run-${number}`
    return createHumanGraphRunner({ ctx })({
      taskId: `task-${number}`,
      userInput: 'Continue task.'
    })
  }
  return { ...f, records, calls, compactionInputs, ctx, run }
}

describe('user instruction skill runtime', () => {
  it('exposes separate strict string-array loader schemas and scopes the instruction catalog', () => {
    const f = fixture()
    expect(LOAD_SKILL_SCHEMA.parse({ skillNames: ['a'] })).toEqual({ skillNames: ['a'] })
    expect(LOAD_TOOLSET_SCHEMA.parse({ toolsetIds: ['docx-read'] })).toEqual({
      toolsetIds: ['docx-read']
    })
    expect(LOAD_SKILL_SCHEMA.safeParse({ toolsetIds: ['docx-read'] }).success).toBe(false)
    expect(LOAD_TOOLSET_SCHEMA.safeParse({ skillNames: ['a'] }).success).toBe(false)
    expect(LOAD_SKILL_SCHEMA.safeParse({ skillIds: ['user:a'] }).success).toBe(false)
    expect(
      LOAD_SKILL_SCHEMA.safeParse({ skillNames: ['a'], toolsetIds: ['docx-read'] }).success
    ).toBe(false)
    expect(
      LOAD_TOOLSET_SCHEMA.safeParse({ toolsetIds: ['docx-read'], skillNames: ['a'] }).success
    ).toBe(false)
    const catalog = renderUserSkills(f.ctx)
    expect(catalog.indexOf('- a：')).toBeLessThan(catalog.indexOf('- b：'))
    expect(catalog).not.toContain('user:')
    expect(catalog).not.toContain('createdAt')
    expect(catalog).not.toContain('directoryName')
    expect(catalog).not.toContain('BODY_A')
    f.enabled.delete('user:b')
    f.enabled.set('user:b', 'BODY_B')
    expect(renderUserSkills(f.ctx)).toBe(catalog)
    expect(renderUserSkills({ ...f.ctx, partnerId: 'another-partner' })).toBe('')
  })

  it('loads instructions without registering tools and deduplicates repeated loading', async () => {
    const f = fixture()
    let state = await f.loadSkills(['a', 'a', 'missing'])
    expect(state.toolsets.loadedToolsetIds).toEqual([])
    expect(state.skills.loadedSkillIds).toEqual(['user:a'])
    expect(state.execution.lastSkillLoadingOutcome).toMatchObject({
      loadedSkillNames: ['a'],
      unavailableSkills: [{ name: 'missing', error: 'Skill is not available' }]
    })
    expect(f.cache.familyToolsets).toEqual({})
    expect(f.cache.toolsetTools).toEqual({})
    state = await f.loadSkills(['a'], state)
    expect(state.execution.lastSkillLoadingOutcome).toMatchObject({
      loadedSkillNames: [],
      skippedDuplicateSkillNames: ['a']
    })
    state = await refreshUserSkillContext({ ...f, state })
    const firstPrompt = String(f.cache.messages![0].content)
    await refreshUserSkillContext({ ...f, state })
    expect(String(f.cache.messages![0].content)).toBe(firstPrompt)
    expect(firstPrompt.split('BODY_A')).toHaveLength(2)
    expect(firstPrompt).toContain('/skills/a')
    expect(JSON.stringify(f.log)).not.toContain('BODY_A')
    state = await f.loadSkills(['b'], state)
    state = await f.loadSkills(['a'], state)
    await refreshUserSkillContext({ ...f, state })
    const orderedPrompt = String(f.cache.messages![0].content)
    expect(state.skills.loadedSkillIds).toEqual(['user:a', 'user:b'])
    expect(orderedPrompt.indexOf('BODY_A')).toBeLessThan(orderedPrompt.indexOf('BODY_B'))
    expect(orderedPrompt.indexOf('当前运行环境：')).toBeLessThan(
      orderedPrompt.indexOf('工具组目录：')
    )
    expect(orderedPrompt.indexOf('工具组目录：')).toBeLessThan(orderedPrompt.indexOf('技能：'))
    expect(orderedPrompt).not.toContain('user:')
  })

  it('rejects cross-kind IDs while preserving independent state and tool budgets', async () => {
    const f = fixture()
    let state = await f.loadSkills(['docx-read', 'a'])
    expect(state.toolsets.loadedToolsetIds).toEqual([])
    expect(state.skills.loadedSkillIds).toEqual(['user:a'])
    expect(state.execution.lastSkillLoadingOutcome).toMatchObject({
      loadedSkillNames: ['a'],
      unavailableSkills: [{ name: 'docx-read', error: 'Skill is not available' }]
    })
    expect(f.cache.toolsetTools).toEqual({})
    state = await f.loadToolsets(['user:b', 'docx-read'], state)
    expect(state.toolsets.loadedToolsetIds).toEqual(['docx-read'])
    expect(state.skills.loadedSkillIds).toEqual(['user:a'])
    expect(state.execution.lastToolsetLoadingOutcome).toMatchObject({
      loadedToolsetIds: ['docx-read'],
      skippedUnknownToolsetIds: ['user:b']
    })
    expect(Object.keys(f.cache.toolsetTools)).toEqual(['docx-read'])
    const projection = projectMessageLogRecords(
      f.log.map((entry, i) => ({ seq: i + 1, entry })) as ChatMessageLogRecord[]
    )
    expect(projection.loadedToolsetIds).toEqual(['docx-read'])
    expect(projection.loadedSkillIds).toEqual(['user:a'])
    expect(f.log).toContainEqual(
      expect.objectContaining({
        kind: 'annotation',
        eventType: 'skill_state_updated',
        payload: { loadedSkillIds: ['user:a'] }
      })
    )
    expect(f.log).toContainEqual(
      expect.objectContaining({
        kind: 'annotation',
        eventType: 'toolset_state_updated',
        payload: { loadedToolsetIds: ['docx-read'] }
      })
    )
  })

  it('does not resolve either loader as a fallback for cross-kind-only requests', async () => {
    const f = fixture()
    const skillState = await f.loadSkills(['docx-read'])
    expect(skillState.execution.lastSkillLoadingOutcome).toMatchObject({
      loadedSkillNames: [],
      unavailableSkills: [{ name: 'docx-read', error: 'Skill is not available' }]
    })
    const toolsetState = await f.loadToolsets(['user:a'], skillState)
    expect(toolsetState.execution.lastToolsetLoadingOutcome).toMatchObject({
      loadedToolsetIds: [],
      skippedUnknownToolsetIds: ['user:a']
    })
    expect(toolsetState.skills.loadedSkillIds).toEqual([])
    expect(toolsetState.toolsets.loadedToolsetIds).toEqual([])
    expect(f.cache.toolsetTools).toEqual({})
    expect(String(f.cache.messages![0].content)).not.toContain('BODY_A')
  })

  it('revalidates edited, disabled and deleted instructions and persists only skill revocation', async () => {
    const f = fixture()
    let state = await f.loadToolsets(['docx-read'])
    state = await f.loadSkills(['a'], state)
    state = await refreshUserSkillContext({ ...f, state })
    f.enabled.set('user:a', 'UPDATED_BODY')
    state = await refreshUserSkillContext({ ...f, state })
    expect(String(f.cache.messages![0].content)).toContain('UPDATED_BODY')
    expect(String(f.cache.messages![0].content)).not.toContain('BODY_A')
    f.enabled.delete('user:a')
    state = await refreshUserSkillContext({ ...f, state })
    expect(state.skills.loadedSkillIds).toEqual([])
    expect(state.toolsets.loadedToolsetIds).toEqual(['docx-read'])
    expect(Object.keys(f.cache.toolsetTools)).toEqual(['docx-read'])
    expect(String(f.cache.messages![0].content)).not.toContain('UPDATED_BODY')
    expect(f.log.at(-1)).toMatchObject({
      eventType: 'skill_state_updated',
      payload: { loadedSkillIds: [] }
    })
    f.enabled.set('user:a', 'RE_ENABLED')
    await refreshUserSkillContext({ ...f, state })
    expect(String(f.cache.messages![0].content)).not.toContain('RE_ENABLED')
  })

  it('ignores legacy or malformed snapshots and restores only valid independent loader IDs', () => {
    // Historical JSON is read as data, not trusted as the current annotation contract.
    const records = [
      {
        seq: 1,
        entry: {
          kind: 'annotation',
          eventType: 'skill_state_updated',
          payload: { learnedSkillIds: ['docx-read', 'user:stale'] }
        }
      },
      {
        seq: 2,
        entry: {
          kind: 'annotation',
          eventType: 'skill_state_updated',
          payload: { loadedSkillIds: 'user:stale' }
        }
      },
      {
        seq: 3,
        entry: {
          kind: 'annotation',
          eventType: 'toolset_state_updated',
          payload: { loadedToolsetIds: null }
        }
      }
    ] as ChatMessageLogRecord[]
    expect(() => projectMessageLogRecords(records)).not.toThrow()
    expect(projectMessageLogRecords(records)).toMatchObject({
      loadedSkillIds: [],
      loadedToolsetIds: []
    })
    records.push(
      {
        seq: 4,
        entry: {
          kind: 'annotation',
          eventType: 'toolset_state_updated',
          payload: { loadedToolsetIds: ['docx-read'] }
        }
      } as ChatMessageLogRecord,
      {
        seq: 5,
        entry: {
          kind: 'annotation',
          eventType: 'skill_state_updated',
          payload: { loadedSkillIds: ['user:a'] }
        }
      } as ChatMessageLogRecord
    )
    expect(projectMessageLogRecords(records)).toMatchObject({
      loadedToolsetIds: ['docx-read'],
      loadedSkillIds: ['user:a']
    })
  })

  it('restores IDs after compaction without stale bodies or another partner instructions', async () => {
    const f = fixture()
    const toolsetState = await f.loadToolsets(['docx-read'])
    await f.loadSkills(['a', 'b'], toolsetState)
    const records = f.log.map((entry, i) => ({ seq: i + 1, entry })) as ChatMessageLogRecord[]
    const projection = projectMessageLogRecords(records)
    f.enabled.delete('user:b')
    f.enabled.set('user:a', 'CURRENT_BODY')
    f.cache.messages = [new SystemMessage('rebuilt'), new HumanMessage('compacted summary')]
    const restored = await refreshUserSkillContext({
      ...f,
      state: {
        ...f.state,
        toolsets: { loadedToolsetIds: projection.loadedToolsetIds },
        skills: { loadedSkillIds: projection.loadedSkillIds }
      }
    })
    expect(restored.skills.loadedSkillIds).toEqual(['user:a'])
    expect(restored.toolsets.loadedToolsetIds).toEqual(['docx-read'])
    expect(String(f.cache.messages![0].content)).toContain('CURRENT_BODY')
    expect(String(f.cache.messages![0].content)).not.toContain('BODY_B')
    expect(loadCurrentUserSkills({ ...f.ctx, partnerId: 'another-partner' }, ['user:a'])).toEqual(
      []
    )
  })

  it('runs both real graph loaders, restore and compaction with independent tools and stable skill prompts', async () => {
    const { enabled, records, calls, compactionInputs, ctx, run } = graphFixture([
      { name: 'load_toolset', args: { toolsetIds: ['docx-read'] } },
      { name: 'load_skill', args: { skillNames: ['a'] } },
      { name: 'load_skill', args: { skillNames: ['a'] } }
    ])

    expect((await run(1)).status).toBe('completed')
    expect(calls).toHaveLength(4)
    expect(calls[0].tools).not.toContain('docx_read_outline')
    expect(calls[1].tools).toContain('docx_read_outline')
    expect(calls[1].text).not.toContain('BODY_A')
    expect(calls[2].text.split('BODY_A')).toHaveLength(2)
    expect(calls[2].text).toContain('/skills/a')
    expect(calls[2].tools).toEqual(calls[1].tools)
    expect(calls[3].tools).toEqual(calls[1].tools)
    expect(calls[3].system).toBe(calls[2].system)
    expect(calls[3].system.split('BODY_A')).toHaveLength(2)
    expect(calls[0].tools.filter((name) => name.startsWith('load_')).sort()).toEqual([
      'load_skill',
      'load_toolset'
    ])
    const loadedTools = calls[1].tools
    expect(projectMessageLogRecords(records)).toMatchObject({
      loadedToolsetIds: ['docx-read'],
      loadedSkillIds: ['user:a']
    })

    // A new graph has no runtime cache: restore each kind's IDs and reread current instructions.
    enabled.set('user:a', 'EDITED_BODY')
    expect((await run(2)).status).toBe('completed')
    expect(calls.at(-1)!.text).toContain('EDITED_BODY')
    expect(calls.at(-1)!.text).not.toContain('BODY_A')
    expect(calls.at(-1)!.tools).toEqual(loadedTools)

    // Exercise production budget -> compaction -> projection -> brain, not a synthetic checkpoint.
    await ctx.appendMessageLog([
      { kind: 'user', content: 'An earlier long task. '.repeat(8000), input: 'old task' },
      { kind: 'assistant', content: 'Earlier work completed. '.repeat(8000), toolCalls: [] }
    ])
    ctx.humanRuntimeOverrides = { modelContextWindowTokens: 12000 }
    expect((await run(3)).status).toBe('completed')
    expect(compactionInputs.length).toBeGreaterThan(0)
    expect(compactionInputs.join('\n')).not.toContain('BODY_A')
    expect(compactionInputs.join('\n')).not.toContain('EDITED_BODY')
    expect(
      records.some(
        (record) =>
          record.entry.kind === 'annotation' && record.entry.eventType === 'compaction_checkpoint'
      )
    ).toBe(true)
    expect(calls.at(-1)!.text.split('EDITED_BODY')).toHaveLength(2)
    expect(calls.at(-1)!.tools).toEqual(loadedTools)
    expect(projectMessageLogRecords(records)).toMatchObject({
      loadedToolsetIds: ['docx-read'],
      loadedSkillIds: ['user:a']
    })

    enabled.delete('user:a')
    expect((await run(4)).status).toBe('completed')
    expect(calls.at(-1)!.text).not.toContain('BODY_A')
    expect(calls.at(-1)!.text).not.toContain('EDITED_BODY')
    expect(calls.at(-1)!.text).not.toContain('/skills/a')
    expect(calls.at(-1)!.tools).toEqual(loadedTools)
    expect(JSON.stringify(records)).not.toContain('EDITED_BODY')
    expect(projectMessageLogRecords(records)).toMatchObject({
      loadedToolsetIds: ['docx-read'],
      loadedSkillIds: []
    })
  })

  it('prunes restored registered tools in FIFO order without touching instructions or repeating snapshots', async () => {
    const { records, calls, ctx, run } = graphFixture()
    await ctx.appendMessageLog([
      {
        kind: 'annotation',
        eventType: 'toolset_state_updated',
        payload: { loadedToolsetIds: [...EXTERNAL_RUNTIME_TOOLSET_IDS] }
      },
      {
        kind: 'annotation',
        eventType: 'skill_state_updated',
        payload: { loadedSkillIds: ['user:a'] }
      }
    ])
    expect((await run(1)).status).toBe('completed')
    const projection = projectMessageLogRecords(records)
    expect(calls[0].tools.length).toBeLessThanOrEqual(HUMAN_MAX_ACTIVE_TOOLS)
    expect(projection.loadedToolsetIds.length).toBeLessThan(EXTERNAL_RUNTIME_TOOLSET_IDS.length)
    expect(projection.loadedToolsetIds).toEqual(
      EXTERNAL_RUNTIME_TOOLSET_IDS.slice(-projection.loadedToolsetIds.length)
    )
    expect(projection.loadedSkillIds).toEqual(['user:a'])
    expect(calls[0].system.split('BODY_A')).toHaveLength(2)
    const snapshotCount = () =>
      records.filter(
        ({ entry }) => entry.kind === 'annotation' && entry.eventType === 'toolset_state_updated'
      ).length
    expect(snapshotCount()).toBe(2)
    expect((await run(2)).status).toBe('completed')
    expect(calls[1].tools).toEqual(calls[0].tools)
    expect(projectMessageLogRecords(records).loadedSkillIds).toEqual(['user:a'])
    expect(snapshotCount()).toBe(2)
  })

  it('rejects oversized restored instructions instead of silently discarding later skills', () => {
    const f = fixture()
    f.enabled.set('user:a', 'x'.repeat(MAX_USER_SKILL_BODY_BYTES))
    expect(() => loadCurrentUserSkills(f.ctx, ['user:a', 'user:b'])).toThrow(/64 KiB/)
    expect(loadCurrentUserSkills(f.ctx, ['user:a']).map(({ skill }) => skill.id)).toEqual([
      'user:a'
    ])
    expect(loadCurrentUserSkills({ ...f.ctx, userSkillService: undefined }, ['user:a'])).toEqual([])
  })
})
