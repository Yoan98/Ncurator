import { describe, expect, it } from 'vitest'
import { createEmbeddingRuntimeDispatcher } from '../../../../../src/main/services/vector/runtime/embeddingRuntimeProcess'
import type {
  EmbeddingExecutor,
  EmbeddingRuntimeRequest,
  EmbeddingRuntimeResponse
} from '../../../../../src/main/services/vector/runtime/types'

describe('embedding runtime contract', () => {
  it('serializes every inference request through one executor', async () => {
    let activeCalls = 0
    let maxActiveCalls = 0
    const callOrder: string[] = []
    const responses: EmbeddingRuntimeResponse[] = []
    let initialized = false
    const executor: EmbeddingExecutor = {
      initialize: async () => {
        initialized = true
        callOrder.push('initialize')
      },
      embed: async (texts) => {
        if (!initialized) throw new Error('not initialized')
        activeCalls += 1
        maxActiveCalls = Math.max(maxActiveCalls, activeCalls)
        callOrder.push(`start:${texts[0]}`)
        await new Promise<void>((resolve) => setTimeout(resolve, 20))
        callOrder.push(`end:${texts[0]}`)
        activeCalls -= 1
        return {
          data: Float32Array.from([texts[0].length]),
          dims: [1, 1]
        }
      }
    }
    const dispatcher = createEmbeddingRuntimeDispatcher({
      executor,
      postMessage: (response) => responses.push(response)
    })

    const requests: EmbeddingRuntimeRequest[] = [
      { requestId: 'initialize', action: 'initialize', payload: null },
      { requestId: 'first', action: 'embed', payload: { texts: ['alpha'] } },
      { requestId: 'second', action: 'embed', payload: { texts: ['beta'] } }
    ]
    requests.forEach((request) => dispatcher.dispatch(request))
    await dispatcher.whenIdle()

    expect(maxActiveCalls).toBe(1)
    expect(callOrder).toEqual(['initialize', 'start:alpha', 'end:alpha', 'start:beta', 'end:beta'])
    expect(responses.map((response) => response.requestId)).toEqual([
      'initialize',
      'first',
      'second'
    ])
    expect(responses.every((response) => response.ok)).toBe(true)
  })
})
