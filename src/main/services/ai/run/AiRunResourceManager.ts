export type AiRunResourceReleaser = {
  id: string
  releaseRun: (runId: string) => Promise<void>
}

export class AiRunResourceManager {
  private readonly releasers = new Map<string, AiRunResourceReleaser>()
  private readonly releasePromises = new Map<string, Promise<void>>()

  public constructor(releasers: readonly AiRunResourceReleaser[] = []) {
    for (const releaser of releasers) this.register(releaser)
  }

  public register(releaser: AiRunResourceReleaser): void {
    const id = String(releaser.id || '').trim()
    if (!id) throw new Error('run resource releaser id is required')
    if (typeof releaser.releaseRun !== 'function') {
      throw new Error(`run resource releaser is invalid: ${id}`)
    }
    if (this.releasers.has(id)) {
      throw new Error(`run resource releaser already registered: ${id}`)
    }
    this.releasers.set(id, { id, releaseRun: releaser.releaseRun })
  }

  public releaseRun(runId: string): Promise<void> {
    const normalizedRunId = String(runId || '').trim()
    if (!normalizedRunId) return Promise.resolve()

    const existing = this.releasePromises.get(normalizedRunId)
    if (existing) return existing

    const releasePromise = this.releaseAll(normalizedRunId).finally(() => {
      this.releasePromises.delete(normalizedRunId)
    })
    this.releasePromises.set(normalizedRunId, releasePromise)
    return releasePromise
  }

  private async releaseAll(runId: string): Promise<void> {
    const entries = [...this.releasers.values()]
    const results = await Promise.allSettled(
      entries.map(async (releaser) => {
        await releaser.releaseRun(runId)
      })
    )

    results.forEach((result, index) => {
      if (result.status !== 'rejected') return
      console.error('[AI-RUN-RESOURCE] release failed', {
        resourceId: entries[index]?.id || 'unknown',
        runId,
        error: result.reason
      })
    })
  }
}
