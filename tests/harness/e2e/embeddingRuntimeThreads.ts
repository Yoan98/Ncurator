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

const TITLE_SEARCH_INTERVAL_MS = 500

const wait = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

const isPageClosedError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  return /Target page, context or browser has been closed|Target closed|Page closed/i.test(message)
}

const readEmbeddingRuntimeSnapshot = async (page: Page): Promise<EmbeddingRuntimeSnapshot | null> => {
  if (page.isClosed()) return null
  try {
    return await page.evaluate(async () => await window.api.getEmbeddingStatus())
  } catch (error) {
    if (page.isClosed() || isPageClosedError(error)) return null
    throw error
  }
}

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
  let lastTitleSearchAt = 0

  while (Date.now() < deadline) {
    if (input.page.isClosed()) {
      throw new Error('embedding runtime measurement stopped because the page closed')
    }
    const snapshot = await readEmbeddingRuntimeSnapshot(input.page)
    if (!snapshot) {
      throw new Error('embedding runtime measurement stopped because the page closed')
    }
    lastSnapshot = snapshot
    const snapshotPid = snapshot.pid && snapshot.pid !== input.excludePid ? snapshot.pid : 0
    let titled: { pid: number; command?: string } | null = null
    if (!snapshotPid && Date.now() - lastTitleSearchAt >= TITLE_SEARCH_INTERVAL_MS) {
      lastTitleSearchAt = Date.now()
      titled = findEmbeddingRuntimeProcess(input.electronPid, input.excludePid)
    }
    const resolvedPid = snapshotPid || titled?.pid || 0
    if (resolvedPid) {
      pid = resolvedPid
      intraOpNumThreads =
        snapshot.intraOpNumThreads > 0
          ? snapshot.intraOpNumThreads
          : (parseEmbeddingRuntimeBudgetFromCommand(titled?.command)?.intraOpNumThreads ??
            intraOpNumThreads)
      let threads: number
      try {
        threads = countProcessThreads(resolvedPid)
      } catch {
        await wait(10)
        continue
      }
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
