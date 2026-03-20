import { buildSkillCatalog } from '../learningNode/skillRegistry'
import type { HumanState, HumanTaskInput } from '../../types'

export const createInitialHumanState = (task: HumanTaskInput): HumanState => ({
  task,
  runtime: {
    stage: 'brain',
    status: 'running'
  },
  brainMemory: {
    inside: {
      facts: [],
      evidences: [],
      openQuestions: []
    },
    outside: {
      skillCatalog: buildSkillCatalog(),
      learnedSkillIds: [],
      brainDecisions: []
    }
  },
  trace: {
    steps: []
  }
})
