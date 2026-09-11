import { createHumanGraphRunner } from '../../../src/main/services/ai/human/graph/humanGraph'
import { runAiRuntimePreflight } from '../../../src/main/services/ai/runtimePreflight'
import { AiRunResourceManager } from '../../../src/main/services/ai/run/AiRunResourceManager'
import { releaseDocxRunSession } from '../../../src/main/services/ai/human/tools/docx/worker/docxWorkerClient'
import { releasePdfRunSession } from '../../../src/main/services/pdf/worker/pdfWorkerClient'
import type {
  HumanRunDispatchOptions,
  HumanTaskInput,
  HumanTaskOutput
} from '../../../src/main/services/ai/types'
import type { BackendTestRuntime, CreateAiRunContextInput } from './test-types'

export const createHumanTestRunner = (
  runtime: BackendTestRuntime,
  contextInput: CreateAiRunContextInput = {}
) => {
  const ctx = runtime.createAiRunContext({
    ...contextInput
  })
  const run = createHumanGraphRunner({ ctx })
  const resourceManager = new AiRunResourceManager([
    { id: 'docx', releaseRun: releaseDocxRunSession },
    { id: 'pdf', releaseRun: releasePdfRunSession }
  ])

  return {
    ctx,
    runner: run,
    run: async (taskInput: HumanTaskInput, dispatchOptions?: HumanRunDispatchOptions) => {
      await runAiRuntimePreflight({
        ensureEmbeddingReady: runtime.ensureEmbeddingReady
      })
      try {
        return (await run(taskInput, dispatchOptions)) as HumanTaskOutput
      } finally {
        await resourceManager.releaseRun(ctx.runId)
      }
    }
  }
}
