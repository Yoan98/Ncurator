import { buildDirectorGraph } from '../../../src/main/services/ai/director/graph/directorGraph'
import {
  createInitialAiRunState,
  type DirectorGraphState
} from '../../../src/main/services/ai/director/state/schema'
import type { BackendTestRuntime, CreateAiRunContextInput } from './test-types'

const DEFAULT_DIRECTOR_SESSION_ID = 'director-test-session'
const DEFAULT_DIRECTOR_INPUT = '请处理当前 director 测试任务。'
const DEFAULT_RECURSION_LIMIT = 128

type CreateDirectorTestRunnerOptions = {
  maxContextRounds?: number
  recursionLimit?: number
}

export const createDirectorTestRunner = (
  runtime: BackendTestRuntime,
  contextInput: CreateAiRunContextInput = {},
  options: CreateDirectorTestRunnerOptions = {}
) => {
  const ctx = runtime.createAiRunContext(contextInput)
  const graph = buildDirectorGraph({
    ctx,
    maxContextRounds: options.maxContextRounds
  })

  return {
    ctx,
    run: async (input?: {
      sessionId?: string
      userInput?: string
    }): Promise<DirectorGraphState> => {
      const initialState = {
        ...createInitialAiRunState({
          runId: runtime.runId,
          sessionId: input?.sessionId || DEFAULT_DIRECTOR_SESSION_ID,
          input: input?.userInput || DEFAULT_DIRECTOR_INPUT
        })
      } as DirectorGraphState

      return await graph.invoke(initialState, {
        recursionLimit: options.recursionLimit ?? DEFAULT_RECURSION_LIMIT
      }) as DirectorGraphState
    }
  }
}
