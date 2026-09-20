import os from 'node:os'
import type { KnowledgeIndexSpeed } from '../../../shared/types'

export type OrtThreadBudget = {
  intraOpNumThreads: number
  allowSpinning: boolean
}

export const resolveLogicalCoreCount = (logicalCores?: number): number => {
  const resolved =
    logicalCores ??
    (typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length)
  return Math.max(1, Math.floor(resolved))
}

export const resolveOrtThreadBudget = (
  speed: KnowledgeIndexSpeed,
  logicalCores = resolveLogicalCoreCount()
): OrtThreadBudget => {
  const cores = resolveLogicalCoreCount(logicalCores)
  if (speed === 'fast') {
    const reserve = cores <= 8 ? 1 : 2
    return {
      intraOpNumThreads: Math.max(2, cores - reserve),
      allowSpinning: true
    }
  }
  return {
    intraOpNumThreads: Math.max(1, Math.floor(cores / 2)),
    allowSpinning: false
  }
}
