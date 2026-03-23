import type { AiRunState } from '../../types'

export const createCompleteNode = () => {
  return async (state: AiRunState): Promise<Partial<AiRunState>> => {
    if (state.status === 'failed' || state.status === 'cancelled' || state.status === 'completed') {
      return {
        directorStage: 'director_complete'
      }
    }

    return {
      status: 'completed',
      directorStage: 'director_complete'
    }
  }
}
