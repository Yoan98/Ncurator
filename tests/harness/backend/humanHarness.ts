import { createHumanGraphRunner } from '../../../src/main/services/ai/graph/humanGraph'
import type {
  HumanRunDispatchOptions,
  HumanTaskInput,
  HumanTaskOutput
} from '../../../src/main/services/ai/types'
import type { BackendTestRuntime, CreateAiRunContextInput } from './test-types'

export const createHumanTestRunner = (
  runtime: BackendTestRuntime,
  contextInput: CreateAiRunContextInput = {},
  options: { maxSteps?: number } = {}
) => {
  const ctx = runtime.createAiRunContext(contextInput)
  const run = createHumanGraphRunner({
    ctx,
    maxSteps: options.maxSteps
  })

  return {
    ctx,
    run: async (taskInput: HumanTaskInput, dispatchOptions: HumanRunDispatchOptions) =>
      await run(taskInput, dispatchOptions) as HumanTaskOutput
  }
}
