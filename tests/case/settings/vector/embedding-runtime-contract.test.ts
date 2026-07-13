import { describe, it } from 'vitest'
import { createEmbeddingRuntimeDispatcher } from '../../../../src/main/services/vector/runtime/embeddingRuntimeProcess'
import type {
  EmbeddingExecutor,
  EmbeddingRuntimeRequest,
  EmbeddingRuntimeResponse
} from '../../../../src/main/services/vector/runtime/types'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

describe('settings vector backend', () => {
  it('embedding-runtime-contract', async () => {
    await runBackendCase({
      caseId: 'embedding-runtime-contract',
      harnessMode: 'tool-real',
      domain: 'settings',
      suite: 'vector',
      description: 'embedding runtime 只保留一个串行推理执行器，并使用请求协议返回结果。',
      fixtures: [],
      runMode: 'single',
      execute: async () => {
        let initialized = false
        let activeCalls = 0
        let maxActiveCalls = 0
        const executor: EmbeddingExecutor = {
          initialize: async () => {
            initialized = true
          },
          embed: async (texts) => {
            if (!initialized) throw new Error('not initialized')
            activeCalls += 1
            maxActiveCalls = Math.max(maxActiveCalls, activeCalls)
            await new Promise<void>((resolve) => setTimeout(resolve, 20))
            activeCalls -= 1
            return {
              data: Float32Array.from(texts.map((text) => text.length)),
              dims: [texts.length, 1]
            }
          }
        }
        const responses: EmbeddingRuntimeResponse[] = []
        const dispatcher = createEmbeddingRuntimeDispatcher({
          executor,
          postMessage: (response) => responses.push(response)
        })
        const requests: EmbeddingRuntimeRequest[] = [
          { requestId: 'initialize', action: 'initialize', payload: null },
          { requestId: 'first', action: 'embed', payload: { texts: ['first'] } },
          { requestId: 'second', action: 'embed', payload: { texts: ['second'] } }
        ]
        requests.forEach((request) => dispatcher.dispatch(request))
        await dispatcher.whenIdle()
        return {
          maxActiveCalls,
          responses: responses.map((response) => ({
            requestId: response.requestId,
            action: response.action,
            ok: response.ok,
            dims: response.action === 'embed' ? response.payload?.dims : undefined
          }))
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.maxActiveCalls === 1 &&
            result.responses.length === 3 &&
            result.responses.every((response) => response.ok) &&
            result.responses.map((response) => response.requestId).join(',') ===
              'initialize,first,second',
          {
            name: 'embedding-runtime-serializes-all-inference',
            message: '所有 embedding 请求必须由同一个 runtime 按顺序执行，不能并行进入 ONNX。',
            data: result
          }
        )
      }
    })
  })
})
