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

export const EMBEDDING_INTRA_OP_THREADS_ENV = 'NCURATOR_EMBEDDING_INTRA_OP_THREADS'
export const EMBEDDING_ALLOW_SPINNING_ENV = 'NCURATOR_EMBEDDING_ALLOW_SPINNING'

export const toOrtSessionOptions = (budget: OrtThreadBudget) => ({
  intraOpNumThreads: budget.intraOpNumThreads,
  interOpNumThreads: 1,
  extra: {
    'session.intra_op.allow_spinning': budget.allowSpinning ? '1' : '0'
  }
})

export const toEmbeddingRuntimeEnv = (budget: OrtThreadBudget) => ({
  [EMBEDDING_INTRA_OP_THREADS_ENV]: String(budget.intraOpNumThreads),
  [EMBEDDING_ALLOW_SPINNING_ENV]: budget.allowSpinning ? '1' : '0'
})

export const parseEmbeddingRuntimeEnv = (env: NodeJS.ProcessEnv): OrtThreadBudget | null => {
  const threads = Number(env[EMBEDDING_INTRA_OP_THREADS_ENV])
  if (!Number.isInteger(threads) || threads <= 0) return null
  return {
    intraOpNumThreads: threads,
    allowSpinning: env[EMBEDDING_ALLOW_SPINNING_ENV] === '1'
  }
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
