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

  it('dispatches consecutive learn_skill calls one at a time', () => {
    const baseState = createInitialHumanState({
      taskId: 'learning-dispatch',
      userInput: '学习两个技能'
    })
    const queue = buildDispatchQueue([
      { id: 'learn-1', name: 'learn_skill', args: { skillIds: ['docx-read'] } },
      { id: 'learn-2', name: 'learn_skill', args: { skillIds: ['excel-read'] } }
    ])
    const first = advanceDispatchState({
      ...baseState,
      execution: { ...baseState.execution, stage: 'dispatch', pendingDispatch: queue }
    })
    expect(first.execution.pendingRound?.nextAction).toMatchObject({
      action: 'learning',
      toolCallId: 'learn-1'
    })
    expect(first.execution.pendingDispatch?.map((item) => item.toolCallId)).toEqual(['learn-2'])

    const second = advanceDispatchState(returnToDispatch(first))
    expect(second.execution.pendingRound?.nextAction).toMatchObject({
      action: 'learning',
      toolCallId: 'learn-2'
    })
    expect(second.execution.pendingDispatch).toBeUndefined()
  })
})
