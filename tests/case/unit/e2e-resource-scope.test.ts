import { describe, expect, it } from 'vitest'
import {
  E2EResourceScope,
  registerE2EResource,
  runWithE2EResourceScope
} from '../../harness/e2e/resourceScope'

describe('E2EResourceScope', () => {
  it('disposes each phase once in reverse registration order', async () => {
    const order: string[] = []
    const scope = new E2EResourceScope()
    await runWithE2EResourceScope(scope, async () => {
      registerE2EResource({
        name: 'workspace-a',
        phase: 'after-app-close',
        dispose: async () => void order.push('workspace-a')
      })
      registerE2EResource({
        name: 'server',
        phase: 'before-app-close',
        dispose: async () => void order.push('server')
      })
      registerE2EResource({
        name: 'workspace-b',
        phase: 'after-app-close',
        dispose: async () => void order.push('workspace-b')
      })
    })

    await expect(scope.dispose('before-app-close')).resolves.toEqual([])
    await expect(scope.dispose('after-app-close')).resolves.toEqual([])
    await expect(scope.dispose('after-app-close')).resolves.toEqual([])
    expect(order).toEqual(['server', 'workspace-b', 'workspace-a'])
  })

  it('collects disposal errors without skipping other resources', async () => {
    const scope = new E2EResourceScope()
    let disposed = false
    scope.register({
      name: 'remaining',
      phase: 'after-app-close',
      dispose: async () => {
        disposed = true
      }
    })
    scope.register({
      name: 'broken',
      phase: 'after-app-close',
      dispose: async () => {
        throw new Error('locked')
      }
    })

    const errors = await scope.dispose('after-app-close')

    expect(disposed).toBe(true)
    expect(errors).toHaveLength(1)
    expect(errors[0]?.name).toBe('broken')
    expect(errors[0]?.error.message).toBe('locked')
  })
})
