export type EmbeddingResult = {
  data: Float32Array
  dims: [number, number]
}

export type EmbeddingExecutor = {
  initialize: () => Promise<void>
  embed: (texts: string[]) => Promise<EmbeddingResult>
  close?: () => Promise<void>
}

export type EmbeddingRuntimeRequest =
  | {
      requestId: string
      action: 'initialize'
      payload: null
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
