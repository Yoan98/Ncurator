import type { Page } from 'playwright'
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

export const waitForEmbeddingReady = async (page: Page, timeoutMs = 60_000): Promise<void> => {
  await page.waitForFunction(
    async () => (await window.api.getEmbeddingStatus()) === 'ready',
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

  while (Date.now() < deadline) {
    const proc = findEmbeddingRuntimeProcess(input.electronPid, input.excludePid)
    if (proc) {
      pid = proc.pid
      intraOpNumThreads =
        parseEmbeddingRuntimeBudgetFromCommand(proc.command)?.intraOpNumThreads ?? intraOpNumThreads
      const threads = countProcessThreads(proc.pid)
      const status = await input.page.evaluate(async () => await window.api.getEmbeddingStatus())
      if (status !== 'ready') {
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
      summarizeDirectChildren(input.electronPid)
    )}`
  )
}
