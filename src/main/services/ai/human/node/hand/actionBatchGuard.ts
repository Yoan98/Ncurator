import { randomUUID } from 'node:crypto'
import type { HumanActionBatch, HumanActionSpec, HumanObservation } from '../../types'
import { canBatchPlan } from './toolExecutionMeta'

const createInvalidActionBatchObservation = (summary: string): HumanObservation => {
  return {
    id: randomUUID(),
    kind: 'tool_result',
    toolName: '__action_batch_guard__',
    ok: false,
    code: 'invalid_input',
    summary
  }
}

export const validateActionBatch = (input: {
  actionBatch: HumanActionBatch | undefined
  maxParallel: number
}): { ok: true; invokeActions: Array<Extract<HumanActionSpec, { type: 'invoke_tool' }>> } | { ok: false; observation: HumanObservation } => {
  const actionBatch = input.actionBatch
  if (!actionBatch || actionBatch.actions.length === 0) {
    return {
      ok: false,
      observation: createInvalidActionBatchObservation('missing action batch')
    }
  }

  const invokeActions = actionBatch.actions.filter(
    (action): action is Extract<HumanActionSpec, { type: 'invoke_tool' }> => action.type === 'invoke_tool'
  )
  const hasCapabilityActivation = actionBatch.actions.some(
    (action) => action.type === 'activate_capability'
  )

  if (
    actionBatch.actions.length > 1 &&
    (hasCapabilityActivation ||
      !canBatchPlan({
        actions: invokeActions.map((action) => ({
          toolName: action.toolName,
          args: action.args
        })),
        maxParallel: input.maxParallel
      }))
  ) {
    return {
      ok: false,
      observation: createInvalidActionBatchObservation('invalid execution batch')
    }
  }

  return {
    ok: true,
    invokeActions
  }
}
