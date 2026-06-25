import type { AiRunDeps } from './types'

const DEFAULT_EMBEDDING_PREFLIGHT_TIMEOUT_MS = 15_000

const readEmbeddingPreflightTimeoutMs = (): number => {
  const raw = Number(process.env.NCURATOR_AI_EMBEDDING_PREFLIGHT_TIMEOUT_MS)
  if (!Number.isFinite(raw)) return DEFAULT_EMBEDDING_PREFLIGHT_TIMEOUT_MS
  return Math.max(0, Math.floor(raw))
}

export const runAiRuntimePreflight = async (
  deps: Pick<AiRunDeps, 'ensureEmbeddingReady'>
): Promise<void> => {
  const timeoutMs = readEmbeddingPreflightTimeoutMs()
  if (timeoutMs === 0) {
    await deps.ensureEmbeddingReady()
    return
  }

  const ensureReadyPromise = deps.ensureEmbeddingReady()
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    timeoutHandle = setTimeout(() => resolve('timeout'), timeoutMs)
  })

  const result = await Promise.race([
    ensureReadyPromise.then(() => 'ready' as const),
    timeoutPromise
  ])
  if (timeoutHandle) clearTimeout(timeoutHandle)
  if (result === 'ready') return

  ensureReadyPromise.catch((error) => {
    console.warn('[AI-RUN] embedding preflight completed after timeout with error:', error)
  })
  console.warn(`[AI-RUN] embedding preflight timed out after ${timeoutMs}ms; continuing run`)
}
