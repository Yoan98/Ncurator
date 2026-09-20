import type { Page } from 'playwright'
import type { EmbeddingRuntimeSnapshot } from '../../../src/shared/types'
import {
  countProcessThreads,
  findEmbeddingRuntimeProcess,
  parseEmbeddingRuntimeBudgetFromCommand,
  summarizeDirectChildren
} from '../core/processThreads.mjs'

export type EmbeddingRuntimeThreadMeasurement = {
  pid: number
  before: number
  after: number
  delta: number
  intraOpNumThreads: number | null
}

const wait = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

const readEmbeddingRuntimeSnapshot = async (page: Page): Promise<EmbeddingRuntimeSnapshot> =>
  await page.evaluate(async () => await window.api.getEmbeddingStatus())

export const waitForEmbeddingReady = async (page: Page, timeoutMs = 60_000): Promise<void> => {
  await page.waitForFunction(
    async () => (await window.api.getEmbeddingStatus()).status === 'ready',
    undefined,
    { timeout: timeoutMs }
  )
}

export const waitForEmbeddingRuntimeProcessGone = async (input: {
  pid: number
  timeoutMs?: number
}): Promise<void> => {
  const deadline = Date.now() + (input.timeoutMs || 10_000)
  while (Date.now() < deadline) {
    try {
      process.kill(input.pid, 0)
    } catch {
      return
    }
    await wait(20)
  }
  throw new Error(`embedding runtime pid ${String(input.pid)} did not exit`)
}

export const measureEmbeddingRuntimeThreadDelta = async (input: {
  page: Page
  electronPid: number
  excludePid?: number
  timeoutMs?: number
}): Promise<EmbeddingRuntimeThreadMeasurement> => {
  const deadline = Date.now() + (input.timeoutMs || 60_000)
  let pid = 0
  let before: number | null = null
  let intraOpNumThreads: number | null = null
  let readyAt: number | null = null
  let after = 0
  let lastSnapshot: EmbeddingRuntimeSnapshot | null = null

  while (Date.now() < deadline) {
    const snapshot = await readEmbeddingRuntimeSnapshot(input.page)
    lastSnapshot = snapshot
    const titled = findEmbeddingRuntimeProcess(input.electronPid, input.excludePid)
    const snapshotPid =
      snapshot.pid && snapshot.pid !== input.excludePid ? snapshot.pid : 0
    const resolvedPid = snapshotPid || titled?.pid || 0
    if (resolvedPid) {
      pid = resolvedPid
      intraOpNumThreads =
        snapshot.intraOpNumThreads > 0
          ? snapshot.intraOpNumThreads
          : (parseEmbeddingRuntimeBudgetFromCommand(titled?.command)?.intraOpNumThreads ??
            intraOpNumThreads)
      const threads = countProcessThreads(resolvedPid)
      if (snapshot.status !== 'ready') {
        before = before === null ? threads : Math.min(before, threads)
        readyAt = null
      } else {
        if (before === null) before = threads
        after = Math.max(after, threads)
        if (readyAt === null) readyAt = Date.now()
        if (Date.now() - readyAt >= 400) {
          return {
            pid,
            before,
            after,
            delta: after - before,
            intraOpNumThreads
          }
        }
      }
    }
    await wait(10)
  }

  throw new Error(
    `embedding runtime process was not measured under electron pid ${String(input.electronPid)}: ${JSON.stringify(
      {
        snapshot: lastSnapshot,
        children: summarizeDirectChildren(input.electronPid)
      }
    )}`
  )
}
