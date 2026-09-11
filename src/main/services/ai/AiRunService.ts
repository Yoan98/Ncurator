import { createHumanGraphRunner } from './human/graph/humanGraph'
import { createAiRunContext } from './runtime'
import { runAiRuntimePreflight } from './runtimePreflight'
import {
  createCancelledAiRunState,
  createCompletedAiRunState,
  createFailedAiRunState
} from './run/state'
import type { AiRunDeps, AiRunStartPayload, AiRunState } from './types'
import { classifyThrownErrorToAiRunFailure, isCancelledError } from './utils/runFailure'
import { resolveAiRunFailurePresentation } from './runFailureCatalog'

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
      if (isCancelledError(e)) {
        return createCancelledAiRunState({
          runId: payload.runId,
          partnerId: payload.partnerId,
          input: payload.input
        })
      }
      const failure = classifyThrownErrorToAiRunFailure(e)
      if (failure.failureCode === 'user_cancelled') {
        return createCancelledAiRunState({
          runId: payload.runId,
          partnerId: payload.partnerId,
          input: payload.input
        })
      }
      const presentation = resolveAiRunFailurePresentation(
        failure.failureCode,
        failure.rawMessage
      )
      const failureSource = presentation.source === 'user' ? 'internal' : presentation.source
      deps.sendEvent({
        type: 'run_failed',
        runId: payload.runId,
        source: failureSource,
        message: presentation.message,
        rawMessage: presentation.rawMessage,
        httpStatus: failure.httpStatus,
        providerCode: failure.providerCode,
        code: failure.failureCode
      })
      return createFailedAiRunState({
        runId: payload.runId,
        partnerId: payload.partnerId,
        input: payload.input,
        error: presentation.message,
        failureRawMessage: presentation.rawMessage,
        failureSource,
        failureHttpStatus: failure.httpStatus,
        failureProviderCode: failure.providerCode,
        failureCode: failure.failureCode
      })
    }
  }
}
