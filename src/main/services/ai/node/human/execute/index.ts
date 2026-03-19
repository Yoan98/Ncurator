import type { HumanActionSpec, HumanObservation } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import { appendHumanTraceStep, emitHumanStep } from '../shared/events'
import { getActiveToolNames } from '../shared/runtime'
import type { HumanRuntimeCache, HumanState } from '../shared/state'
import { validateActionBatch } from './actionBatchGuard'
import { executeCapabilityActivation } from './capabilityExecutor'
import { createToolInvoker } from './toolInvoker'

export const createHumanExecuteNode = (input: { ctx: AiRunContext; cache: HumanRuntimeCache }) => {
  const invokeToolAction = createToolInvoker(input)

  return async (state: HumanState): Promise<Partial<HumanState>> => {
    input.ctx.checkCancelled()

    const guard = validateActionBatch({
      actionBatch: state.turn.actionBatch,
      maxParallel: state.progress.maxParallel
    })
    if (!guard.ok) {
      return {
        ...state,
        progress: {
          ...state.progress,
          phase: 'reasoning'
        },
        turn: {
          ...state.turn,
          incoming: {
            summary: guard.observation.summary,
            observations: [guard.observation]
          },
          actionBatch: undefined
        }
      }
    }

    const actionBatch = state.turn.actionBatch
    if (!actionBatch) {
      return state
    }

    let nextState = state
    const nextTrace = [...state.trace.steps]
    const collectedObservations: HumanObservation[] = []

    if (actionBatch.actions.length === 1 && actionBatch.actions[0].type === 'activate_capability') {
      const action = actionBatch.actions[0]
      const execution = executeCapabilityActivation({
        ctx: input.ctx,
        cache: input.cache,
        state: nextState,
        action
      })
      const nextStepIndex = nextTrace.length + 1
      nextTrace.push(
        ...appendHumanTraceStep({
          steps: [],
          step: nextStepIndex,
          action: 'load_skill',
          publicNarrative: action.publicNarrative,
          resultStatus: 'ok',
          skillId: action.skillId,
          summary: execution.observation.summary
        })
      )
      nextState = execution.nextState
      emitHumanStep({
        ctx: input.ctx,
        runId: input.ctx.runId,
        taskId: state.task.taskId,
        stepIndex: nextStepIndex,
        action: 'load_skill',
        publicNarrative: action.publicNarrative,
        activeSkillIds: nextState.memory.capabilityFocus.activeStack,
        activeToolNames: getActiveToolNames({
          state: nextState,
          cache: input.cache
        }),
        summary: execution.observation.summary,
        resultStatus: 'ok',
        skillId: action.skillId,
        stage: 'human_execute'
      })
      collectedObservations.push(execution.observation)
    } else if (actionBatch.actions.length === 1) {
      const action = actionBatch.actions[0] as Extract<HumanActionSpec, { type: 'invoke_tool' }>
      const execution = await invokeToolAction(nextState, action)
      const nextStepIndex = nextTrace.length + 1
      nextTrace.push(
        ...appendHumanTraceStep({
          steps: [],
          step: nextStepIndex,
          action: 'invoke_tool',
          publicNarrative: action.publicNarrative,
          resultStatus: execution.resultStatus,
          toolName: action.toolName,
          summary: execution.observation.summary
        })
      )
      emitHumanStep({
        ctx: input.ctx,
        runId: input.ctx.runId,
        taskId: state.task.taskId,
        stepIndex: nextStepIndex,
        action: 'invoke_tool',
        publicNarrative: action.publicNarrative,
        activeSkillIds: nextState.memory.capabilityFocus.activeStack,
        activeToolNames: getActiveToolNames({
          state: nextState,
          cache: input.cache
        }),
        summary: execution.observation.summary,
        resultStatus: execution.resultStatus,
        toolName: action.toolName,
        stage: 'human_execute'
      })
      collectedObservations.push(execution.observation)
    } else {
      const executions = await Promise.all(
        guard.invokeActions.map((action) => invokeToolAction(nextState, action))
      )
      for (let index = 0; index < guard.invokeActions.length; index += 1) {
        const action = guard.invokeActions[index]
        const execution = executions[index]
        const nextStepIndex = nextTrace.length + 1
        nextTrace.push(
          ...appendHumanTraceStep({
            steps: [],
            step: nextStepIndex,
            action: 'invoke_tool',
            publicNarrative: action.publicNarrative,
            resultStatus: execution.resultStatus,
            toolName: action.toolName,
            summary: execution.observation.summary
          })
        )
        emitHumanStep({
          ctx: input.ctx,
          runId: input.ctx.runId,
          taskId: state.task.taskId,
          stepIndex: nextStepIndex,
          action: 'invoke_tool',
          publicNarrative: action.publicNarrative,
          activeSkillIds: nextState.memory.capabilityFocus.activeStack,
          activeToolNames: getActiveToolNames({
            state: nextState,
            cache: input.cache
          }),
          summary: execution.observation.summary,
          resultStatus: execution.resultStatus,
          toolName: action.toolName,
          stage: 'human_execute'
        })
        collectedObservations.push(execution.observation)
      }
    }

    return {
      ...nextState,
      progress: {
        ...nextState.progress,
        phase: 'reasoning'
      },
      turn: {
        incoming: {
          summary: collectedObservations.map((item) => item.summary).join(' | ') || 'execution completed',
          observations: collectedObservations
        },
        analysis: nextState.turn.analysis,
        actionBatch: undefined,
        watchdogHint: nextState.turn.watchdogHint
      },
      trace: {
        steps: nextTrace
      }
    }
  }
}
