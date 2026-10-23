import type { EmbeddingRuntimeProcessInfo } from '../../../../shared/types'

export type EmbeddingResult = {
  data: Float32Array
  dims: [number, number]
  modelIdentity?: string
}

export type EmbeddingThreadBudget = {
  intraOpNumThreads: number
  allowSpinning: boolean
}

export type EmbeddingExecutor = {
  initialize: () => Promise<void>
  embed: (texts: string[]) => Promise<EmbeddingResult>
  setThreadBudget?: (budget: EmbeddingThreadBudget) => void
  getRuntimeProcessInfo?: () => EmbeddingRuntimeProcessInfo
  restart?: () => Promise<void>
  close?: () => Promise<void>
  cancelPending?: () => Promise<void>
}

export type EmbeddingRuntimeRequest =
  | {
      requestId: string
      action: 'initialize'
      payload: EmbeddingThreadBudget | null
    }
  | {
      requestId: string
      action: 'embed'
      payload: { texts: string[] }
    }

export type EmbeddingRuntimeResponse =
  | {
      requestId: string
      action: 'initialize'
      ok: boolean
      error?: string
    }
  | {
      requestId: string
      action: 'embed'
      ok: boolean
      payload?: EmbeddingResult
      error?: string
    }

export type EmbeddingRuntimePendingRequest = {
  resolve: (response: EmbeddingRuntimeResponse) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}
