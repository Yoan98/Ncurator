import { isSystemMessage, SystemMessage } from '@langchain/core/messages'
import type { AiRunContext } from '../types'
import type { HumanRuntimeCache, HumanState } from './types'
import { buildBrainSystemPrompt } from './prompts/brain'
import { loadCurrentUserSkills } from './userSkills'

/** Rebuild, rather than append, the sole instruction snapshot before budget checks and inference.
 * Bodies never enter the transcript/compaction, so restoring names always reads current bindings/files.
 */
export const refreshUserSkillContext = async (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  state: HumanState
}): Promise<HumanState> => {
  const previous = input.state.skills.loadedSkillNames || []
  const loaded = loadCurrentUserSkills(input.ctx, previous)
  const names = loaded.map(({ skill }) => skill.name)
  const state = { ...input.state, skills: { ...input.state.skills, loadedSkillNames: names } }
  if (JSON.stringify(previous) !== JSON.stringify(names)) {
    await input.ctx.appendMessageLog([
      {
        kind: 'annotation',
        eventType: 'skill_state_updated',
        payload: { loadedSkillNames: names }
      }
    ])
  }
  if (input.cache.messages?.[0] && isSystemMessage(input.cache.messages[0])) {
    input.cache.messages[0] = new SystemMessage(
      buildBrainSystemPrompt({ ctx: input.ctx, loadedSkills: loaded })
    )
  }
  input.cache.currentState = state
  return state
}
