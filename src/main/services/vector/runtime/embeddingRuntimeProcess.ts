import { TransformersEmbeddingExecutor } from './TransformersEmbeddingExecutor'
import { parseEmbeddingRuntimeEnv, resolveOrtThreadBudget } from '../indexSpeed'
import type {
  EmbeddingRuntimeRequest,
  EmbeddingRuntimeResponse,
  EmbeddingExecutor,
  EmbeddingThreadBudget
} from './types'

type UtilityProcessMessageEvent = { data: unknown }
type UtilityProcessParentPort = {
  on: (event: 'message', listener: (event: UtilityProcessMessageEvent) => void) => void
  postMessage: (message: EmbeddingRuntimeResponse) => void
}

const runtimeProcess = process as NodeJS.Process & {
  parentPort?: UtilityProcessParentPort
}

const modelsPath = String(process.env.NCURATOR_EMBEDDING_MODELS_PATH || '').trim()
const modelName = String(process.env.NCURATOR_EMBEDDING_MODEL_NAME || '').trim()

const parseEnvThreadBudget = (): EmbeddingThreadBudget =>
  parseEmbeddingRuntimeEnv(process.env) || resolveOrtThreadBudget('slow')

export const createEmbeddingRuntimeRequestHandler = (executor: EmbeddingExecutor) =>
  async (request: EmbeddingRuntimeRequest): Promise<EmbeddingRuntimeResponse> => {
    try {
      if (request.action === 'initialize') {
        await executor.initialize()
        return {
          requestId: request.requestId,
          action: 'initialize',
          ok: true
        }
      }

      const result = await executor.embed(request.payload.texts)
      return {
        requestId: request.requestId,
        action: 'embed',
        ok: true,
        payload: result
      }
    } catch (error) {
      return {
        requestId: request.requestId,
        action: request.action,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      } as EmbeddingRuntimeResponse
    }
  }

export const createEmbeddingRuntimeDispatcher = (input: {
  executor: EmbeddingExecutor
  postMessage: (response: EmbeddingRuntimeResponse) => void
}) => {
  const handleRequest = createEmbeddingRuntimeRequestHandler(input.executor)
  let inferenceQueue: Promise<void> = Promise.resolve()
  return {
    dispatch: (request: EmbeddingRuntimeRequest): void => {
      inferenceQueue = inferenceQueue.then(async () => {
        input.postMessage(await handleRequest(request))
      })
    },
    whenIdle: async (): Promise<void> => {
      await inferenceQueue
    }
  }
}

const parentPort = runtimeProcess.parentPort

if (parentPort) {
  const executor = new TransformersEmbeddingExecutor({
    modelsPath,
    modelName,
    threadBudget: parseEnvThreadBudget()
  })
  const dispatcher = createEmbeddingRuntimeDispatcher({
    executor,
    postMessage: (response) => parentPort.postMessage(response)
  })

  parentPort.on('message', (event) => {
    const request = event.data as EmbeddingRuntimeRequest
    dispatcher.dispatch(request)
  })
}
