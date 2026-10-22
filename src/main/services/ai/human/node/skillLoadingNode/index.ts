import type { AiRunContext } from '../../../types'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { isUserSkillId, loadCurrentUserSkills } from '../../userSkills'
import { appendToolFeedback } from '../../shared/toolFeedback'
import { emitToolCallResult, emitToolCallStarted } from '../../tools/utils/toolEvents'
import { returnToBrainAfterTrace, returnToDispatch } from '../utils/stateTransitions'

/** Instruction loading never registers tools or changes their permissions/budget. */
export const createSkillLoadingNode = (input: { ctx: AiRunContext; cache: HumanRuntimeCache }) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    const action = state.execution.pendingRound?.nextAction
    if (!action || action.action !== 'skill_loading') return returnToDispatch(state)
    const requestedSkillIds = [...new Set(action.wantLoadSkillIds.filter((id) => id.trim()))]
    const previousIds = state.skills.loadedSkillIds
    const currentlyLoaded = loadCurrentUserSkills(input.ctx, previousIds).map(
      ({ skill }) => skill.id
    )
    const loaded = loadCurrentUserSkills(input.ctx, [
      ...currentlyLoaded,
      ...requestedSkillIds.filter(isUserSkillId)
    ])
    const loadedSkillIds = loaded.map(({ skill }) => skill.id)
    const newlyLoaded = requestedSkillIds.filter(
      (id) => loadedSkillIds.includes(id) && !currentlyLoaded.includes(id)
    )
    const duplicates = requestedSkillIds.filter(
      (id) => loadedSkillIds.includes(id) && currentlyLoaded.includes(id)
    )
    const unavailable = requestedSkillIds.filter((id) => !loadedSkillIds.includes(id))
    const ok = newlyLoaded.length + duplicates.length > 0
    const outcome = {
      requestedSkillIds,
      loadedSkillIds: newlyLoaded,
      skippedDuplicateSkillIds: duplicates,
      unavailableSkillIds: unavailable
    }
    emitToolCallStarted({
      ctx: input.ctx,
      runId: input.ctx.runId,
      toolCallId: action.toolCallId,
      toolName: 'load_skill',
      args: { skillIds: requestedSkillIds },
      stage: 'human_skill_loading'
    })
    await input.ctx.appendMessageLog(
      newlyLoaded.map((skillId) => ({
        kind: 'annotation' as const,
        eventType: 'skill_loading_started' as const,
        payload: { skillId }
      }))
    )
    const content = [
      ok
        ? 'User instruction loading completed.'
        : 'Error: No requested user instruction was available.',
      newlyLoaded.length ? `loaded=${newlyLoaded.join(', ')}` : '',
      duplicates.length ? `alreadyLoaded=${duplicates.join(', ')}` : '',
      unavailable.length
        ? `unavailable=${unavailable.join(', ')} (disabled, missing, invalid ID, unsafe file, or context limit)`
        : '',
      ok
        ? 'Current instruction bodies and resource bases are supplied once in the current skill context. No toolsets or permissions were added.'
        : ''
    ]
      .filter(Boolean)
      .join(' ')
    await appendToolFeedback({
      ...input,
      toolCallId: action.toolCallId,
      toolName: 'load_skill',
      ok,
      content
    })
    await input.ctx.appendMessageLog([
      ...newlyLoaded.map((skillId) => ({
        kind: 'annotation' as const,
        eventType: 'skill_loading_completed' as const,
        payload: { skillId }
      })),
      ...(JSON.stringify(previousIds) !== JSON.stringify(loadedSkillIds)
        ? [
            {
              kind: 'annotation' as const,
              eventType: 'skill_state_updated' as const,
              payload: { loadedSkillIds }
            }
          ]
        : [])
    ])
    emitToolCallResult({
      ctx: input.ctx,
      runId: input.ctx.runId,
      toolCallId: action.toolCallId,
      toolName: 'load_skill',
      result: ok
        ? { toolName: 'load_skill', ok: true, data: outcome }
        : { toolName: 'load_skill', ok: false, data: { error: content } },
      stage: 'human_skill_loading'
    })
    return returnToBrainAfterTrace({
      ...input,
      state,
      traceItems: [
        {
          action: 'load_skill',
          toolName: 'load_skill',
          publicNarrative: '加载用户技能说明',
          resultStatus: ok ? 'ok' : 'error',
          summary: content
        }
      ],
      stage: 'human_skill_loading',
      overrides: {
        skills: { loadedSkillIds },
        execution: { lastSkillLoadingOutcome: outcome }
      }
    })
  }
}
