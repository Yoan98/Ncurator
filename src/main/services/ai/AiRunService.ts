import { buildDirectorGraph } from './director/graph/directorGraph'
import { createAiRunContext } from './runtime'
import {
  type DirectorGraphState,
  createCancelledAiRunState,
  createFailedAiRunState,
  createInitialAiRunState,
  toPublicAiRunState
} from './director/state/schema'
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
    const ctx = createAiRunContext(payload, deps)
    const graph = buildDirectorGraph({ ctx })
    try {
      const res = await graph.invoke(
        createInitialAiRunState({
          runId: payload.runId,
          sessionId: payload.sessionId,
          input: String(payload.input || '')
        }) as DirectorGraphState
      )
      return toPublicAiRunState(res as DirectorGraphState)
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
