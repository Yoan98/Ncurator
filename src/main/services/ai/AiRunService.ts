import { createHumanGraphRunner } from './human/graph/humanGraph'
import { createAiRunContext } from './runtime'
import { runAiRuntimePreflight } from './runtimePreflight'
import {
  createCompletedAiRunState,
  createCancelledAiRunState,
  createFailedAiRunState,
} from './run/state'
import type { AiRunDeps, AiRunStartPayload, AiRunState } from './types'

const isCancelledError = (error: unknown): boolean =>
  Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'CANCELLED')

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
        sessionId: payload.sessionId,
        input: String(payload.input || ''),
        finalDeliveryMarkdown: output.deliveryMarkdown,
        finalArtifacts: output.artifacts || []
      })
    } catch (e) {
      if (isCancelledError(e)) {
        return createCancelledAiRunState({
          runId: payload.runId,
          sessionId: payload.sessionId,
          input: payload.input
        })
      }
      const msg = e instanceof Error ? e.message : String(e)
      return createFailedAiRunState({
        runId: payload.runId,
        sessionId: payload.sessionId,
        input: payload.input,
        error: msg
      })
    }
  }
}
