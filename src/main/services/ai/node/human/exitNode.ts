import type { HumanRunState } from './types'

export const createHumanExitNode = () => {
  return async (_state: HumanRunState): Promise<Partial<HumanRunState>> => {
    return {}
  }
}
