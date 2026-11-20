/**
 * A system suspend freezes the main process. Timers and network streams stop
 * with it, so a model call that spans a suspend must be treated as an external
 * interruption instead of a model timeout.
 */
export const SYSTEM_SUSPEND_INTERRUPT_THRESHOLD_MS = 5_000

type SuspendListener = () => void
type ResumeListener = (gapMs: number) => void

export class SystemSuspendMonitor {
  private suspendedAt: number | undefined
  private readonly suspendListeners = new Set<SuspendListener>()
  private readonly resumeListeners = new Set<ResumeListener>()

  public get suspended(): boolean {
    return this.suspendedAt !== undefined
  }

  public markSuspend(at = Date.now()): void {
    if (this.suspendedAt !== undefined) return
    this.suspendedAt = at
    for (const listener of this.suspendListeners) listener()
  }

  public markResume(at = Date.now()): void {
    if (this.suspendedAt === undefined) return
    const gapMs = Math.max(0, at - this.suspendedAt)
    this.suspendedAt = undefined
    for (const listener of this.resumeListeners) listener(gapMs)
  }

  public onSuspend(listener: SuspendListener): () => void {
    this.suspendListeners.add(listener)
    return () => {
      this.suspendListeners.delete(listener)
    }
  }

  public onResume(listener: ResumeListener): () => void {
    this.resumeListeners.add(listener)
    return () => {
      this.resumeListeners.delete(listener)
    }
  }
}

export const systemSuspendMonitor = new SystemSuspendMonitor()

type PowerMonitorSource = {
  onSuspend: (listener: () => void) => void
  onResume: (listener: () => void) => void
}

export const startSystemSuspendMonitor = (source: PowerMonitorSource): void => {
  source.onSuspend(() => systemSuspendMonitor.markSuspend())
  source.onResume(() => systemSuspendMonitor.markResume())
}
