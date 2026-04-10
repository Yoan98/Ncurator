import { createHumanGraphRunner } from '../../../src/main/services/ai/human/graph/humanGraph'
import { runAiRuntimePreflight } from '../../../src/main/services/ai/runtimePreflight'
import type {
  HumanRunDispatchOptions,
  HumanTaskInput,
  HumanTaskOutput
} from '../../../src/main/services/ai/types'
import type { BackendTestRuntime, CreateAiRunContextInput } from './test-types'

export const createHumanTestRunner = (
  runtime: BackendTestRuntime,
  contextInput: CreateAiRunContextInput = {},
  options: { hardActionLimit?: number } = {}
) => {
  const ctx = runtime.createAiRunContext({
    ...contextInput,
    humanRuntimeOverrides: {
      ...contextInput.humanRuntimeOverrides,
      hardActionLimit: options.hardActionLimit ?? contextInput.humanRuntimeOverrides?.hardActionLimit
    }
  })
  const run = createHumanGraphRunner({ ctx })

  return {
    ctx,
    runner: run,
    run: async (taskInput: HumanTaskInput, dispatchOptions?: HumanRunDispatchOptions) => {
      await runAiRuntimePreflight({
        ensureEmbeddingReady: runtime.ensureEmbeddingReady
      })
      return await run(taskInput, dispatchOptions) as HumanTaskOutput
    }
  }
}
