import type { JsonObject } from '../../../../../../shared/types'
import type { HumanDispatchItem, HumanNextAction, HumanState } from '../../types'

export type HumanDispatchTarget = HumanDispatchItem['target']

const classifyToolCallTarget = (toolName: string): HumanDispatchTarget => {
  const normalized = String(toolName || '').trim()
  if (normalized === 'learn_skill') return 'learning'
  if (normalized === 'update_plan') return 'plan'
  return 'hand'
}

type RawToolCall = {
  id: string
  name: string
  args?: Record<string, unknown>
}

export const buildDispatchQueue = (toolCalls: RawToolCall[]): HumanDispatchItem[] =>
  toolCalls
    .filter((call) => call.name.trim().length > 0)
    .map((call) => ({
      toolCallId: call.id,
      toolName: call.name.trim(),
      args: (call.args || {}) as JsonObject,
      target: classifyToolCallTarget(call.name.trim())
    }))

const dispatchGroupToNextAction = (group: HumanDispatchItem[]): HumanNextAction => {
  const first = group[0]!
  switch (first.target) {
    case 'learning': {
      const skillIds = Array.isArray(first.args.skillIds)
        ? first.args.skillIds.filter((item): item is string => typeof item === 'string')
        : []
      return {
        action: 'learning',
        wantLearnSkillIds: skillIds,
        toolCallId: first.toolCallId
      }
    }
    case 'plan':
      return {
        action: 'plan',
        calls: group.map((item) => ({
          toolCallId: item.toolCallId,
          toolName: item.toolName,
          args: item.args
        }))
      }
    case 'hand':
      return {
        action: 'hand',
        calls: group.map((item) => ({
          toolCallId: item.toolCallId,
          toolName: item.toolName,
          args: item.args
        }))
      }
  }
}

export type DispatchPeek =
  | { empty: true }
  | { empty: false; target: HumanDispatchTarget; nextAction: HumanNextAction; rest: HumanDispatchItem[] }

export const peekDispatchGroup = (queue: HumanDispatchItem[]): DispatchPeek => {
  if (queue.length === 0) return { empty: true }

  const target = queue[0]!.target
  let splitIndex = 1
  while (
    target !== 'learning' &&
    splitIndex < queue.length &&
    queue[splitIndex]!.target === target
  ) {
    splitIndex += 1
  }

  const group = queue.slice(0, splitIndex)
  const rest = queue.slice(splitIndex)
  return {
    empty: false,
    target,
    nextAction: dispatchGroupToNextAction(group),
    rest
  }
}

export const advanceDispatchState = (state: HumanState): HumanState => {
  const queue = state.execution.pendingDispatch || []
  const peeked = peekDispatchGroup(queue)
  if (peeked.empty) {
    return {
      ...state,
      execution: {
        ...state.execution,
        stage: 'context_budget',
        pendingDispatch: undefined,
        pendingRound: undefined
      }
    }
  }

  return {
    ...state,
    execution: {
      ...state.execution,
      stage: peeked.target,
      pendingDispatch: peeked.rest.length > 0 ? peeked.rest : undefined,
      pendingRound: {
        thought: state.execution.pendingRound?.thought || { text: '' },
        nextAction: peeked.nextAction
      }
    }
  }
}
