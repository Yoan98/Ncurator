import type { AiRunDeps } from './types'

export const runAiRuntimePreflight = async (
  deps: Pick<AiRunDeps, 'ensureEmbeddingReady'>
): Promise<void> => {
  await deps.ensureEmbeddingReady()
}
