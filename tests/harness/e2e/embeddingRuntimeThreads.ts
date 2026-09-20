import type { Page } from 'playwright'
import {
  countProcessThreads,
  findEmbeddingRuntimeProcess,
  parseEmbeddingRuntimeBudgetFromCommand,
  summarizeDirectChildren
} from '../core/processThreads.mjs'

export type EmbeddingRuntimeThreadMeasurement = {
  pid: number
  threads: number
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

export const measureEmbeddingRuntimeThreads = async (input: {
  page: Page
  electronPid: number
  excludePid?: number
  timeoutMs?: number
}): Promise<EmbeddingRuntimeThreadMeasurement> => {
  await waitForEmbeddingReady(input.page, input.timeoutMs)
  const deadline = Date.now() + (input.timeoutMs || 30_000)
  while (Date.now() < deadline) {
    const proc = findEmbeddingRuntimeProcess(input.electronPid, input.excludePid)
    if (proc) {
      const budget = parseEmbeddingRuntimeBudgetFromCommand(proc.command)
      return {
        pid: proc.pid,
        threads: countProcessThreads(proc.pid),
        intraOpNumThreads: budget?.intraOpNumThreads ?? null
      }
    }
    await wait(200)
  }
  throw new Error(
    `embedding runtime process not found under electron pid ${String(input.electronPid)}: ${JSON.stringify(
      summarizeDirectChildren(input.electronPid)
    )}`
  )
}
