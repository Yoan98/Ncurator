import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiRunResourceManager } from '../../../../src/main/services/ai/run/AiRunResourceManager'

describe('ai unit run resource manager', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('releases every registered resource for a run', async () => {
    const released: string[] = []
    const manager = new AiRunResourceManager([
      { id: 'docx', releaseRun: async (runId) => released.push(`docx:${runId}`) },
      { id: 'pdf', releaseRun: async (runId) => released.push(`pdf:${runId}`) }
    ])

    await manager.releaseRun('run-1')

    expect(released.sort()).toEqual(['docx:run-1', 'pdf:run-1'])
  })

  it('continues releasing other resources when one releaser fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const released: string[] = []
    const manager = new AiRunResourceManager([
      {
        id: 'docx',
        releaseRun: async () => {
          throw new Error('docx cleanup failed')
        }
      },
      { id: 'pdf', releaseRun: async (runId) => released.push(runId) }
    ])

    await expect(manager.releaseRun('run-2')).resolves.toBeUndefined()

    expect(released).toEqual(['run-2'])
    expect(consoleError).toHaveBeenCalledOnce()
  })

  it('shares concurrent release calls and allows a later retry after completion', async () => {
    let resolveRelease: (() => void) | undefined
    const release = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRelease = resolve
        })
    )
    const manager = new AiRunResourceManager([{ id: 'pdf', releaseRun: release }])

    const first = manager.releaseRun('run-3')
    const second = manager.releaseRun('run-3')
    expect(second).toBe(first)
    expect(release).toHaveBeenCalledOnce()

    resolveRelease?.()
    await first

    const retry = manager.releaseRun('run-3')
    resolveRelease?.()
    await retry
    expect(release).toHaveBeenCalledTimes(2)
  })

  it('rejects duplicate resource ids', () => {
    expect(
      () =>
        new AiRunResourceManager([
          { id: 'pdf', releaseRun: async () => undefined },
          { id: 'pdf', releaseRun: async () => undefined }
        ])
    ).toThrow('already registered')
  })
})
