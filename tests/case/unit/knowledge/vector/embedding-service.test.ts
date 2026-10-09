import { describe, expect, it, vi } from 'vitest'
import {
  EmbeddingService,
  type EmbeddingExecutor
} from '../../../../../src/main/services/vector/EmbeddingService'

const result = {
  data: new Float32Array([1, 2]),
  dims: [1, 2] as [number, number]
}

describe('EmbeddingService', () => {
  it('waits for an in-flight initialization before embedding', async () => {
    let finishInitialization!: () => void
    const executor: EmbeddingExecutor = {
      initialize: vi.fn(
        async () =>
          await new Promise<void>((resolve) => {
            finishInitialization = resolve
          })
      ),
      embed: vi.fn(async () => result)
    }
    const service = new EmbeddingService({ executor })

    const initialization = service.initialize()
    const embedding = service.embed('text')
    expect(executor.embed).not.toHaveBeenCalled()

    finishInitialization()
    await initialization
    await expect(embedding).resolves.toEqual(result)
    expect(executor.initialize).toHaveBeenCalledTimes(1)
  })

  it('wraps initialization failures with a user-facing message and preserves the cause', async () => {
    const executor: EmbeddingExecutor = {
      initialize: vi.fn(async () => {
        throw new Error('model unavailable')
      }),
      embed: vi.fn(async () => result)
    }
    const service = new EmbeddingService({ executor })

    await expect(service.initialize()).rejects.toMatchObject({
      message: expect.stringContaining('向量模型初始化失败'),
      cause: expect.objectContaining({ message: 'model unavailable' })
    })
    expect(service.getStatus()).toBe('error')
  })

  it('exposes the live embedding runtime pid and intraOp from the executor', () => {
    const executor: EmbeddingExecutor = {
      initialize: vi.fn(async () => undefined),
      embed: vi.fn(async () => result),
      getRuntimeProcessInfo: () => ({
        pid: 4242,
        intraOpNumThreads: 7
      })
    }
    const service = new EmbeddingService({ executor })
    expect(service.getRuntimeSnapshot()).toEqual({
      status: 'uninitialized',
      pid: 4242,
      intraOpNumThreads: 7
    })
  })

  it('retries initialization after a failure', async () => {
    const initialize = vi
      .fn<EmbeddingExecutor['initialize']>()
      .mockRejectedValueOnce(new Error('transient failure'))
      .mockResolvedValueOnce(undefined)
    const executor: EmbeddingExecutor = {
      initialize,
      embed: vi.fn(async () => result)
    }
    const service = new EmbeddingService({ executor })

    await expect(service.embed('first')).rejects.toThrow('向量模型初始化失败')
    await expect(service.embed('second')).resolves.toEqual(result)
    expect(initialize).toHaveBeenCalledTimes(2)
  })
})

it('waits for initialization before closing and clears the ready cache', async () => {
  let finish!: () => void
  const executor: EmbeddingExecutor = {
    initialize: () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    embed: async () => result,
    close: vi.fn(async () => undefined)
  }
  const service = new EmbeddingService({ executor })
  const loading = service.initialize()
  const closing = service.close()
  expect(executor.close).not.toHaveBeenCalled()
  finish()
  await loading
  await closing
  expect(executor.close).toHaveBeenCalledTimes(1)
  expect(service.getStatus()).toBe('uninitialized')
})
