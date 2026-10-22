import { isSystemMessage, SystemMessage } from '@langchain/core/messages'
import type { AiRunContext } from '../types'
import type { HumanRuntimeCache, HumanState } from './types'
import { buildBrainSystemPrompt } from './prompts/brain'
import { loadCurrentUserSkills, renderLoadedUserSkills } from './userSkills'

/** Rebuild, rather than append, the sole instruction snapshot before budget checks and inference.
 * Bodies never enter the transcript/compaction, so restoring IDs always reads current bindings/files.
 */
export const refreshUserSkillContext = async (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  state: HumanState
}): Promise<HumanState> => {
  const previous = input.state.skills.loadedSkillIds || []
  const loaded = loadCurrentUserSkills(input.ctx, previous)
  const ids = loaded.map(({ skill }) => skill.id)
  const state = { ...input.state, skills: { ...input.state.skills, loadedSkillIds: ids } }
  if (JSON.stringify(previous) !== JSON.stringify(ids)) {
    await input.ctx.appendMessageLog([
      {
        kind: 'annotation',
        eventType: 'skill_state_updated',
        payload: { loadedSkillIds: ids }
      }
    ])
  }
  if (input.cache.messages?.[0] && isSystemMessage(input.cache.messages[0])) {
    input.cache.messages[0] = new SystemMessage(
      [buildBrainSystemPrompt({ ctx: input.ctx }), renderLoadedUserSkills(loaded)]
        .filter(Boolean)
        .join('\n\n')
    )
  }
  input.cache.currentState = state
  return state
}
