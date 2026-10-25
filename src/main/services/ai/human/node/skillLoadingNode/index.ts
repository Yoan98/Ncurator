import { MAX_USER_SKILL_BODY_BYTES } from '../../../../../../shared/userSkills'
import { getToolDisplayInput } from '../../../../../../shared/assistantToolCopy'
import type { AiRunContext } from '../../../types'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { loadCurrentUserSkills, type LoadedUserSkill } from '../../userSkills'
import { renderLoadSkillModelResult } from '../../shared/modelToolResultRenderers'
import { appendToolFeedback } from '../../shared/toolFeedback'
import { emitToolCallResult, emitToolCallStarted } from '../../tools/utils/toolEvents'
import { returnToBrainAfterTrace, returnToDispatch } from '../utils/stateTransitions'

export const createSkillLoadingNode = (input: { ctx: AiRunContext; cache: HumanRuntimeCache }) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    const action = state.execution.pendingRound?.nextAction
    if (!action || action.action !== 'skill_loading') return returnToDispatch(state)
    const requestedSkillNames = [...new Set(action.wantLoadSkillNames)]
    const previousNames = state.skills.loadedSkillNames
    const current = loadCurrentUserSkills(input.ctx, previousNames)
    const enabled = input.ctx.userSkillService?.listEnabled(input.ctx.partnerId) ?? []
    const newlyLoaded: LoadedUserSkill[] = []
    const skippedDuplicateSkillNames: string[] = []
    const unavailableSkills: Array<{ name: string; error: string }> = []
    emitToolCallStarted({
      ctx: input.ctx,
      runId: input.ctx.runId,
      toolCallId: action.toolCallId,
      toolName: 'load_skill',
      args: { skillNames: requestedSkillNames },
      stage: 'human_skill_loading'
    })
    for (const name of requestedSkillNames) {
      const skill = enabled.find((item) => item.name === name)
      if (!skill || !input.ctx.userSkillService) {
        unavailableSkills.push({ name, error: 'Skill is not available' })
        continue
      }
      if (current.some((item) => item.skill.name === skill.name)) {
        skippedDuplicateSkillNames.push(name)
        continue
      }
      try {
        newlyLoaded.push(input.ctx.userSkillService.loadEnabled(input.ctx.partnerId, skill.name))
      } catch (error) {
        unavailableSkills.push({
          name,
          error: error instanceof Error ? error.message : 'Unable to read skill'
        })
      }
    }
    if (
      [...current, ...newlyLoaded].reduce(
        (sum, item) => sum + Buffer.byteLength(item.body, 'utf8'),
        0
      ) > MAX_USER_SKILL_BODY_BYTES
    ) {
      unavailableSkills.push(
        ...newlyLoaded.map(({ skill }) => ({
          name: skill.name,
          error: 'Skill instructions exceed 64 KiB; adjust the enabled skills'
        }))
      )
      newlyLoaded.length = 0
    }
    const newlyLoadedSkillNames = newlyLoaded.map((item) => item.skill.name)
    const loadedSkillNames = [...current, ...newlyLoaded].map((item) => item.skill.name)
    const outcome = {
      requestedSkillNames,
      loadedSkillNames: newlyLoadedSkillNames,
      skippedDuplicateSkillNames,
      unavailableSkills
    }
    const ok = newlyLoadedSkillNames.length + skippedDuplicateSkillNames.length > 0
    const content = renderLoadSkillModelResult({
      toolName: 'load_skill',
      args: { skillNames: requestedSkillNames },
      data: outcome
    })
    await input.ctx.appendMessageLog(
      newlyLoaded.map(({ skill }) => ({
        kind: 'annotation' as const,
        eventType: 'skill_loading_started' as const,
        payload: { skillName: skill.name }
      }))
    )
    await appendToolFeedback({
      ...input,
      toolCallId: action.toolCallId,
      toolName: 'load_skill',
      ok,
      content,
      displayInput: getToolDisplayInput('load_skill', { skillNames: requestedSkillNames }, outcome)
    })
    await input.ctx.appendMessageLog([
      ...newlyLoaded.map(({ skill }) => ({
        kind: 'annotation' as const,
        eventType: 'skill_loading_completed' as const,
        payload: { skillName: skill.name }
      })),
      ...(JSON.stringify(previousNames) !== JSON.stringify(loadedSkillNames)
        ? [
            {
              kind: 'annotation' as const,
              eventType: 'skill_state_updated' as const,
              payload: { loadedSkillNames }
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
        : { toolName: 'load_skill', ok: false, data: { ...outcome, error: content } },
      stage: 'human_skill_loading'
    })
    return returnToBrainAfterTrace({
      ...input,
      state,
      traceItems: [
        {
          action: 'load_skill',
          toolName: 'load_skill',
          publicNarrative: `加载技能 ${requestedSkillNames.join('、')}`,
          resultStatus: ok ? 'ok' : 'error',
          summary: content
        }
      ],
      stage: 'human_skill_loading',
      overrides: { skills: { loadedSkillNames }, execution: { lastSkillLoadingOutcome: outcome } }
    })
  }
}
