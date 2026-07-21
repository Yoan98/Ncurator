export type AppShutdownTask = {
  name: string
  dispose: () => void | Promise<void>
}

export type AppShutdownFailure = {
  name: string
  error: Error
}

export class AppShutdownCoordinator {
  private readonly tasks: AppShutdownTask[] = []
  private shutdownPromise: Promise<AppShutdownFailure[]> | null = null

  constructor(private readonly taskTimeoutMs = 15_000) {}

  register(task: AppShutdownTask): void {
    if (this.shutdownPromise) {
      throw new Error(`cannot register shutdown task ${task.name} after shutdown started`)
    }
    this.tasks.push(task)
  }

  shutdown(): Promise<AppShutdownFailure[]> {
    if (this.shutdownPromise) return this.shutdownPromise
    this.shutdownPromise = this.runShutdown()
    return this.shutdownPromise
  }

  private async runShutdown(): Promise<AppShutdownFailure[]> {
    const failures: AppShutdownFailure[] = []
    for (const task of [...this.tasks].reverse()) {
      try {
        await this.disposeTask(task)
      } catch (error) {
        failures.push({
          name: task.name,
          error: error instanceof Error ? error : new Error(String(error))
        })
      }
    }
    return failures
  }

  private async disposeTask(task: AppShutdownTask): Promise<void> {
    let timeout: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        Promise.resolve().then(task.dispose),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            reject(new Error(`shutdown task timed out after ${this.taskTimeoutMs}ms`))
          }, this.taskTimeoutMs)
        })
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }
}
