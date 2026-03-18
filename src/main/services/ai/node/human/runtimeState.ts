import type { StructuredToolInterface } from '@langchain/core/tools'
import type { HumanRunState, HumanStatus } from './types'
import { buildActiveTools } from './skillCatalog'

type ActiveToolState = Pick<HumanRunState, 'activeSkillIds' | 'loadedToolsets'>

export const deriveActiveTools = (state: ActiveToolState): StructuredToolInterface[] => {
  return buildActiveTools({
    activeSkillIds: state.activeSkillIds,
    loadedToolsets: state.loadedToolsets
  })
}

export const deriveActiveToolNames = (state: ActiveToolState): string[] => {
  return deriveActiveTools(state)
    .map((tool) => String(tool.name || '').trim())
    .filter(Boolean)
}

export const isHumanTerminalStatus = (
  status: HumanStatus
): status is Extract<HumanStatus, 'completed' | 'blocked'> => {
  return status === 'completed' || status === 'blocked'
}

export const resolveHumanTerminalStatus = (
  state: Pick<HumanRunState, 'lastObservation' | 'resultCode'>
): Extract<HumanStatus, 'completed' | 'blocked'> => {
  if (state.lastObservation?.kind === 'terminal') {
    return state.lastObservation.status
  }
  return state.resultCode === 'ok' ? 'completed' : 'blocked'
}
