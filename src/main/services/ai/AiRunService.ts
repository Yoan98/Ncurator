import { buildDirectorGraph } from './director/graph/directorGraph'
import { createAiRunContext } from './runtime'
import {
  createCancelledAiRunState,
  createFailedAiRunState,
  createInitialAiRunState
} from './director/state/schema'
import type { AiRunDeps, AiRunStartPayload, AiRunState } from './types'

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
    const ctx = createAiRunContext(payload, deps)
    const graph = buildDirectorGraph({ ctx })
    try {
      const res = await graph.invoke(
        createInitialAiRunState({
          runId: payload.runId,
          sessionId: payload.sessionId,
          input: String(payload.input || '')
        }) as AiRunState
      )
      return res as AiRunState
    } catch (e) {
      const err = e as { code?: string; message?: string }
      if (
        err.code === 'CANCELLED' ||
        String(err.message || '')
          .toLowerCase()
          .includes('cancel')
      ) {
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
