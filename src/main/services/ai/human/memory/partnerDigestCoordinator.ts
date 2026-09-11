type DigestJob = {
  partnerId: string
  runId: string
  abort: AbortController
  promise: Promise<void>
}

export class PartnerDigestCoordinator {
  private readonly jobsByRunId = new Map<string, DigestJob>()

  public hasRun(runId: string): boolean {
    return this.jobsByRunId.has(runId)
  }

  public enqueue(input: {
    partnerId: string
    runId: string
    work: (signal: AbortSignal) => Promise<void>
  }): void {
    this.jobsByRunId.get(input.runId)?.abort.abort()
    const abort = new AbortController()
    const job: DigestJob = {
      partnerId: input.partnerId,
      runId: input.runId,
      abort,
      promise: Promise.resolve()
    }
    job.promise = input
      .work(abort.signal)
      .catch(() => undefined)
      .finally(() => {
        if (this.jobsByRunId.get(input.runId) === job) {
          this.jobsByRunId.delete(input.runId)
        }
      })
    this.jobsByRunId.set(input.runId, job)
  }

  public async awaitIdle(partnerId: string): Promise<void> {
    const id = String(partnerId || '').trim()
    if (!id) return
    for (;;) {
      const pending = [...this.jobsByRunId.values()].filter((job) => job.partnerId === id)
      if (pending.length === 0) return
      await Promise.all(pending.map((job) => job.promise))
    }
  }

  public async cancelForPartner(partnerId: string): Promise<void> {
    const id = String(partnerId || '').trim()
    if (!id) return
    const jobs = [...this.jobsByRunId.values()].filter((job) => job.partnerId === id)
    for (const job of jobs) job.abort.abort()
    await Promise.all(jobs.map((job) => job.promise))
  }

  public async cancelForRun(runId: string): Promise<void> {
    const job = this.jobsByRunId.get(runId)
    if (!job) return
    job.abort.abort()
    await job.promise
  }
}

let coordinator: PartnerDigestCoordinator | undefined

export const getPartnerDigestCoordinator = (): PartnerDigestCoordinator => {
  coordinator ||= new PartnerDigestCoordinator()
  return coordinator
}

export const resetPartnerDigestCoordinatorForTests = (): void => {
  coordinator = new PartnerDigestCoordinator()
}
