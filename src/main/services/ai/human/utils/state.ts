import type { HumanState, HumanTaskInput } from '../types'
import {
  DEFAULT_HUMAN_RUNTIME,
  createDefaultHumanRuntime,
  createEmptyHumanTaskInput,
  createDefaultHumanSkillCatalog,
  createDefaultHumanBrainMemoryInside,
  createDefaultHumanBrainMemoryOutside,
  createDefaultHumanBrainMemory,
  createDefaultHumanTrace,
  createDefaultHumanStateFields
} from '../state/schema'

export {
  DEFAULT_HUMAN_RUNTIME,
  createDefaultHumanRuntime,
  createEmptyHumanTaskInput,
  createDefaultHumanSkillCatalog,
  createDefaultHumanBrainMemoryInside,
  createDefaultHumanBrainMemoryOutside,
  createDefaultHumanBrainMemory,
  createDefaultHumanTrace,
  createDefaultHumanStateFields
}

export const createInitialHumanState = (task: HumanTaskInput): HumanState => ({
  ...createDefaultHumanStateFields(),
  task
})
