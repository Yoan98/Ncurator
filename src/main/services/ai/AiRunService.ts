import { buildMainGraph } from './main/graph/mainGraph'
import { createAiRunContext } from './runtime'
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
    const graph = buildMainGraph({ ctx })
    try {
      const res = await graph.invoke({
        runId: payload.runId,
        sessionId: payload.sessionId,
        status: 'running',
        input: String(payload.input || ''),
        mainStage: 'main_intent',
        plan: [],
        contextRounds: 0,
        contextEvidence: [],
        dispatchCursor: 0
      } as AiRunState)
      return res as AiRunState
    } catch (e) {
      const err = e as { code?: string; message?: string }
      if (
        err.code === 'CANCELLED' ||
        String(err.message || '')
          .toLowerCase()
          .includes('cancel')
      ) {
        return {
          runId: payload.runId,
          sessionId: payload.sessionId,
          status: 'cancelled',
          input: payload.input,
          mainStage: 'main_complete',
          plan: [],
          contextRounds: 0,
          contextEvidence: [],
          dispatchCursor: 0,
          error: 'cancelled'
        }
      }
      const msg = e instanceof Error ? e.message : String(e)
      return {
        runId: payload.runId,
        sessionId: payload.sessionId,
        status: 'failed',
        input: payload.input,
        mainStage: 'main_complete',
        plan: [],
        contextRounds: 0,
        contextEvidence: [],
        dispatchCursor: 0,
        error: msg
      }
    }
  }
}
