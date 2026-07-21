import { describe, expect, it, vi } from 'vitest'
import { AppShutdownCoordinator } from '../../../src/main/services/AppShutdownCoordinator'

describe('AppShutdownCoordinator', () => {
  it('disposes tasks once in reverse registration order', async () => {
    const order: string[] = []
    const coordinator = new AppShutdownCoordinator()
    coordinator.register({ name: 'first', dispose: () => void order.push('first') })
    coordinator.register({ name: 'second', dispose: () => void order.push('second') })

    const firstShutdown = coordinator.shutdown()
    const secondShutdown = coordinator.shutdown()

    expect(secondShutdown).toBe(firstShutdown)
    await expect(firstShutdown).resolves.toEqual([])
    expect(order).toEqual(['second', 'first'])
  })

  it('collects failures and continues disposing remaining tasks', async () => {
    const finalDispose = vi.fn()
    const coordinator = new AppShutdownCoordinator()
    coordinator.register({ name: 'final', dispose: finalDispose })
    coordinator.register({
      name: 'broken',
      dispose: () => {
        throw new Error('dispose failed')
      }
    })

    const failures = await coordinator.shutdown()

    expect(finalDispose).toHaveBeenCalledOnce()
    expect(failures).toHaveLength(1)
    expect(failures[0]?.name).toBe('broken')
    expect(failures[0]?.error.message).toBe('dispose failed')
  })

  it('times out a stuck task and continues shutdown', async () => {
    const coordinator = new AppShutdownCoordinator(10)
    coordinator.register({
      name: 'stuck',
      dispose: async () => await new Promise<void>(() => {})
    })

    const failures = await coordinator.shutdown()

    expect(failures).toHaveLength(1)
    expect(failures[0]?.name).toBe('stuck')
    expect(failures[0]?.error.message).toContain('timed out after 10ms')
  })
})
