import { createHumanGraphRunner } from './human/graph/humanGraph'
import { isLlmInputTooLongError, toRendererRunFailure } from './errors'
import { createAiRunContext } from './runtime'
import { runAiRuntimePreflight } from './runtimePreflight'
import {
  createCancelledAiRunState,
  createCompletedAiRunState,
  createFailedAiRunState
} from './run/state'
import type { AiRunDeps, AiRunStartPayload, AiRunState } from './types'
import { isCancelledError, isRecoverableHumanRunError } from './utils/runFailure'
import { classifyInterruptionReason } from './utils/runFailure'

export class AiRunService {
  private static instance: AiRunService

  private constructor() {}

  public static getInstance(): AiRunService {
    if (!AiRunService.instance) {
      AiRunService.instance = new AiRunService()
    }
    return AiRunService.instance
  }

  public async run(payload: AiRunStartPayload, deps: AiRunDeps): Promise<AiRunState> {
    try {
      await runAiRuntimePreflight(deps)
      const ctx = createAiRunContext(payload, deps)
      const runHumanTask = createHumanGraphRunner({ ctx })
      const output = await runHumanTask(
        {
          taskId: payload.runId,
          userInput: String(payload.input || '')
        },
        {
          emitAnswerEvents: true
        }
      )
      return createCompletedAiRunState({
        runId: payload.runId,
        partnerId: payload.partnerId,
        input: String(payload.input || ''),
        finalDeliveryMarkdown: output.deliveryMarkdown,
        finalArtifacts: output.artifacts || []
      })
    } catch (e) {
      const reason = isLlmInputTooLongError(e)
        ? 'input_too_long'
        : isRecoverableHumanRunError(e)
          ? e.reason
          : classifyInterruptionReason(e)
      if (reason === 'user_cancelled' || isCancelledError(e)) {
        return createCancelledAiRunState({
          runId: payload.runId,
          partnerId: payload.partnerId,
          input: payload.input
        })
      }
      const failure = toRendererRunFailure(e)
      const message =
        reason === 'input_too_long'
          ? '当前输入超过模型上下文限制，请缩短后重试。'
          : reason === 'runtime_limit'
          ? '已达到运行上限，可继续对话推进'
          : reason === 'output_truncated'
            ? '模型输出达到长度限制，可发送“继续”接着完成'
            : failure.message
      const failureSource =
        reason === 'input_too_long' || reason === 'runtime_limit' || reason === 'output_truncated'
          ? 'internal'
          : failure.source
      deps.sendEvent({
        type: 'run_failed',
        runId: payload.runId,
        source: failureSource,
        message,
        httpStatus: failure.httpStatus,
        providerCode: failure.providerCode,
        code: reason
      })
      return createFailedAiRunState({
        runId: payload.runId,
        partnerId: payload.partnerId,
        input: payload.input,
        error: message,
        failureSource,
        failureHttpStatus: failure.httpStatus,
        failureProviderCode: failure.providerCode,
        failureCode: reason
      })
    }
  }
}
