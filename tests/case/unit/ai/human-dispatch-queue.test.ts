import { describe, expect, it } from 'vitest'
import {
  advanceDispatchState,
  buildDispatchQueue
} from '../../../../src/main/services/ai/human/node/dispatch'
import { returnToDispatch } from '../../../../src/main/services/ai/human/node/utils/stateTransitions'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'

describe('human dispatch queue', () => {
  it('is the only consumer of mixed plan and hand calls', () => {
    const baseState = createInitialHumanState({
      taskId: 'mixed-dispatch',
      userInput: '更新计划后读取文档'
    })
    const queue = buildDispatchQueue([
      { id: 'plan-1', name: 'update_plan', args: { plan: [] } },
      {
        id: 'search-1',
        name: 'docx_search',
        args: { sourcePath: '/tmp/a.docx', query: '目标' }
      },
      {
        id: 'read-1',
        name: 'docx_read_nodes',
        args: { sourcePath: '/tmp/a.docx', range: { type: 'node_ids', nodeIds: ['node-1'] } }
      }
    ])

    const planState = advanceDispatchState({
      ...baseState,
      execution: {
        ...baseState.execution,
        stage: 'dispatch',
        pendingDispatch: queue
      }
    })
    expect(planState.execution.pendingRound?.nextAction).toMatchObject({ action: 'plan' })
    expect(planState.execution.pendingDispatch?.map((item) => item.toolCallId)).toEqual([
      'search-1',
      'read-1'
    ])

    const handState = advanceDispatchState(returnToDispatch(planState))
    expect(handState.execution.pendingRound?.nextAction).toMatchObject({
      action: 'hand',
      calls: [{ toolCallId: 'search-1' }, { toolCallId: 'read-1' }]
    })
    expect(handState.execution.pendingDispatch).toBeUndefined()

    const completed = advanceDispatchState(returnToDispatch(handState))
    expect(completed.execution.stage).toBe('context_budget')
    expect(completed.execution.pendingRound).toBeUndefined()
  })

  it('dispatches consecutive load_toolset calls one at a time', () => {
    const baseState = createInitialHumanState({
      taskId: 'toolset-loading-dispatch',
      userInput: '加载两个工具组'
    })
    const queue = buildDispatchQueue([
      { id: 'learn-1', name: 'load_toolset', args: { toolsetIds: ['docx-read'] } },
      { id: 'learn-2', name: 'load_toolset', args: { toolsetIds: ['excel-read'] } }
    ])
    const first = advanceDispatchState({
      ...baseState,
      execution: { ...baseState.execution, stage: 'dispatch', pendingDispatch: queue }
    })
    expect(first.execution.pendingRound?.nextAction).toMatchObject({
      action: 'toolset_loading',
      toolCallId: 'learn-1'
    })
    expect(first.execution.pendingDispatch?.map((item) => item.toolCallId)).toEqual(['learn-2'])

    const second = advanceDispatchState(returnToDispatch(first))
    expect(second.execution.pendingRound?.nextAction).toMatchObject({
      action: 'toolset_loading',
      toolCallId: 'learn-2'
    })
    expect(second.execution.pendingDispatch).toBeUndefined()
  })

  it('routes instruction and registered-tool loaders independently and in request order', () => {
    const initial = createInitialHumanState({
      taskId: 'split-loaders',
      userInput: 'Load both kinds'
    })
    const queue = buildDispatchQueue([
      { id: 'skill-1', name: 'load_skill', args: { skillIds: ['user:a'] } },
      { id: 'toolset-1', name: 'load_toolset', args: { toolsetIds: ['docx-read'] } },
      { id: 'skill-2', name: 'load_skill', args: { skillIds: ['user:b'] } }
    ])
    let state = advanceDispatchState({
      ...initial,
      execution: { ...initial.execution, stage: 'dispatch', pendingDispatch: queue }
    })
    expect(state.execution.stage).toBe('skill_loading')
    expect(state.execution.pendingRound?.nextAction).toEqual({
      action: 'skill_loading',
      wantLoadSkillIds: ['user:a'],
      toolCallId: 'skill-1'
    })
    state = advanceDispatchState(returnToDispatch(state))
    expect(state.execution.stage).toBe('toolset_loading')
    expect(state.execution.pendingRound?.nextAction).toEqual({
      action: 'toolset_loading',
      wantLoadToolsetIds: ['docx-read'],
      toolCallId: 'toolset-1'
    })
    state = advanceDispatchState(returnToDispatch(state))
    expect(state.execution.pendingRound?.nextAction).toEqual({
      action: 'skill_loading',
      wantLoadSkillIds: ['user:b'],
      toolCallId: 'skill-2'
    })
    expect(state.execution.pendingDispatch).toBeUndefined()
  })
})
