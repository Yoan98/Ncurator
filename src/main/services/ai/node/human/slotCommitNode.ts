import type { JsonObject, JsonValue } from '../../../../../shared/types'
import type { AiRunContext } from '../../types'
import type { HumanRunState } from './types'

const MAX_INLINE_SLOT_PAYLOAD_CHARS = 1200

const isJsonObject = (value: JsonValue | undefined): value is JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return true
}

export const createHumanSlotCommitNode = (input: {
  ctx: AiRunContext
}) => {
  const { ctx } = input

  return async (state: HumanRunState): Promise<Partial<HumanRunState>> => {
    const payload = state.pendingPayload
    if (!payload || !isJsonObject(payload)) {
      const summary = 'slot commit payload missing'
      ctx.sendEvent({
        type: 'slot_commit',
        runId: state.runId,
        taskId: state.input.taskId,
        stepIndex: state.steps,
        consume: state.consume,
        produce: state.produce,
        success: false,
        message: summary,
        createdAt: Date.now(),
        stage: 'human_slot_commit'
      })
      return {
        terminalState: 'blocked',
        phase: 'exit',
        summary,
        resultCode: 'invalid_input'
      }
    }

    // 先基于快照计算，只有全部校验通过才一次性提交到 state。
    const nextSlotState = { ...state.slotState }
    const nextArtifacts = { ...state.slotArtifacts }

    const missingConsume = state.consume.filter((slotRef) => !Object.hasOwn(nextSlotState, slotRef))
    if (missingConsume.length > 0) {
      const summary = `missing consume slots: ${missingConsume.join(', ')}`
      ctx.sendEvent({
        type: 'slot_commit',
        runId: state.runId,
        taskId: state.input.taskId,
        stepIndex: state.steps,
        consume: state.consume,
        produce: state.produce,
        success: false,
        message: summary,
        createdAt: Date.now(),
        stage: 'human_slot_commit'
      })
      return {
        terminalState: 'blocked',
        phase: 'exit',
        summary,
        resultCode: 'invalid_input'
      }
    }

    const payloadText = JSON.stringify(payload)
    const payloadForSlot: JsonObject =
      payloadText.length > MAX_INLINE_SLOT_PAYLOAD_CHARS
        ? (() => {
            // 大 payload 以引用落盘，slot 只保留 ref + summary。
            const ref = `artifact:${state.input.taskId}:${state.steps}:${Date.now()}`
            nextArtifacts[ref] = payload
            return {
              ref,
              summary: String(payload.summary || 'large payload committed by ref'),
              truncated: true
            }
          })()
        : payload

    const producedDelta: Record<string, JsonValue> = {}
    for (const slotRef of state.produce) {
      nextSlotState[slotRef] = payloadForSlot
      producedDelta[slotRef] = payloadForSlot
    }

    const requiredOutputs = state.expect.length > 0 ? state.expect : state.produce
    const missingOutputs = requiredOutputs.filter((slotRef) => !Object.hasOwn(nextSlotState, slotRef))
    if (missingOutputs.length > 0) {
      const summary = `missing required outputs: ${missingOutputs.join(', ')}`
      ctx.sendEvent({
        type: 'slot_commit',
        runId: state.runId,
        taskId: state.input.taskId,
        stepIndex: state.steps,
        consume: state.consume,
        produce: state.produce,
        success: false,
        message: summary,
        createdAt: Date.now(),
        stage: 'human_slot_commit'
      })
      return {
        terminalState: 'blocked',
        phase: 'exit',
        summary,
        resultCode: 'invalid_input'
      }
    }

    ctx.sendEvent({
      type: 'slot_commit',
      runId: state.runId,
      taskId: state.input.taskId,
      stepIndex: state.steps,
      consume: state.consume,
      produce: state.produce,
      success: true,
      message: 'slot commit success',
      createdAt: Date.now(),
      stage: 'human_slot_commit'
    })

    const nextSlotDelta: JsonObject = {
      ...state.slotDelta,
      ...producedDelta
    }

    return {
      slotState: nextSlotState,
      slotArtifacts: nextArtifacts,
      slotDelta: nextSlotDelta,
      pendingPayload: undefined,
      phase: 'brain'
    }
  }
}
