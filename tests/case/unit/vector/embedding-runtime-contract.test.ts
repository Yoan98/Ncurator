import { describe, expect, it } from 'vitest'
import { createEmbeddingRuntimeDispatcher } from '../../../../src/main/services/vector/runtime/embeddingRuntimeProcess'
import type {
  EmbeddingExecutor,
  EmbeddingRuntimeResponse
} from '../../../../src/main/services/vector/runtime/types'

describe('embedding runtime contract', () => {
  it('serializes every inference request through one executor', async () => {
    let activeCalls = 0
    let maxActiveCalls = 0
    const callOrder: string[] = []
    const responses: EmbeddingRuntimeResponse[] = []
    const executor: EmbeddingExecutor = {
      initialize: async () => {},
      embed: async (texts) => {
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

    dispatcher.dispatch({
      requestId: 'first',
      action: 'embed',
      payload: { texts: ['alpha'] }
    })
    dispatcher.dispatch({
      requestId: 'second',
      action: 'embed',
      payload: { texts: ['beta'] }
    })
    await dispatcher.whenIdle()

    expect(maxActiveCalls).toBe(1)
    expect(callOrder).toEqual(['start:alpha', 'end:alpha', 'start:beta', 'end:beta'])
    expect(responses.map((response) => response.requestId)).toEqual(['first', 'second'])
  })
})
