import type { JsonObject } from '../../../../../../shared/types'
import type { HumanDispatchItem, HumanNextAction, HumanState } from '../../types'

export type HumanDispatchTarget = HumanDispatchItem['target']

const classifyToolCallTarget = (toolName: string): HumanDispatchTarget => {
  const normalized = String(toolName || '').trim()
  if (normalized === 'load_skill') return 'skill_loading'
  if (normalized === 'load_toolset') return 'toolset_loading'
  if (normalized === 'update_plan') return 'plan'
  if (normalized === 'ask_user_question') return 'interaction'
  return 'hand'
}

type RawToolCall = {
  id: string
  name: string
  args?: Record<string, unknown>
}

export const buildDispatchQueue = (toolCalls: RawToolCall[]): HumanDispatchItem[] => {
  return toolCalls
    .filter((call) => call.name.trim().length > 0)
    .map((call) => ({
      toolCallId: call.id,
      toolName: call.name.trim(),
      args: (call.args || {}) as JsonObject,
      target: classifyToolCallTarget(call.name.trim())
    }))
}

const dispatchGroupToNextAction = (group: HumanDispatchItem[]): HumanNextAction => {
  const first = group[0]!
  switch (first.target) {
    case 'interaction':
      return {
        action: 'interaction',
        toolCallId: first.toolCallId,
        toolName: 'ask_user_question',
        args: first.args
      }
    case 'skill_loading': {
      const skillIds = Array.isArray(first.args.skillIds)
        ? first.args.skillIds.filter((item): item is string => typeof item === 'string')
        : []
      return { action: 'skill_loading', wantLoadSkillIds: skillIds, toolCallId: first.toolCallId }
    }
    case 'toolset_loading': {
      const toolsetIds = Array.isArray(first.args.toolsetIds)
        ? first.args.toolsetIds.filter((item): item is string => typeof item === 'string')
        : []
      return {
        action: 'toolset_loading',
        wantLoadToolsetIds: toolsetIds,
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
  | {
      empty: false
      target: HumanDispatchTarget
      nextAction: HumanNextAction
      rest: HumanDispatchItem[]
    }

export const peekDispatchGroup = (queue: HumanDispatchItem[]): DispatchPeek => {
  if (queue.length === 0) return { empty: true }

  const target = queue[0]!.target
  let splitIndex = 1
  while (
    target !== 'toolset_loading' &&
    target !== 'skill_loading' &&
    target !== 'interaction' &&
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
