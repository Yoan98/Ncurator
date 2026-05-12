import { awaitAllCallbacks } from '@langchain/core/callbacks/promises'

export const flushLangChainTracing = async (): Promise<void> => {
  await awaitAllCallbacks()
}
