import type { HumanRuntimeCache } from '../../types'

export const createHumanRuntimeCache = (): HumanRuntimeCache => ({
  toolsets: {},
  toolCallCount: 0
})
