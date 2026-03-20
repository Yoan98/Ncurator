import { buildHumanBrainPrompt } from '../../prompts/brain'
import { getToolPromptSpec } from '../../prompts/toolPrompts'
import { getSkillDefinition } from '../learningNode/skillRegistry'
import type { HumanState } from '../../types'

const toJsonText = (value: object | undefined, fallback = 'none'): string => {
  if (!value) return fallback
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return fallback
  }
}

const buildSkillContextText = (state: HumanState): string => {
  const catalogText =
    state.brainMemory.outside.skillCatalog.length > 0
      ? state.brainMemory.outside.skillCatalog
          .map(
            (item) =>
              `- ${item.skillId}: ${item.summary}; tools=[${item.toolNames.join(', ')}]; whenToUse=${item.whenToUse}`
          )
          .join('\n')
      : 'none'
  const learnedDetailText =
    state.brainMemory.outside.learnedSkillIds.length > 0
      ? state.brainMemory.outside.learnedSkillIds
          .map((skillId) => {
            const definition = getSkillDefinition(skillId)
            return `- ${definition.skillId}: ${definition.detail}`
          })
          .join('\n')
      : 'none'
  const learnedToolSpecText =
    state.brainMemory.outside.learnedSkillIds.length > 0
      ? state.brainMemory.outside.learnedSkillIds
          .flatMap((skillId) => getSkillDefinition(skillId).toolNames)
          .map((toolName) => getToolPromptSpec(toolName))
          .filter((spec): spec is NonNullable<ReturnType<typeof getToolPromptSpec>> => Boolean(spec))
          .map((spec) => {
            const requiredArgs = spec.args
              .filter((arg) => arg.required)
              .map((arg) => `${arg.name}:${arg.type}`)
              .join(', ')
            const example = spec.examples?.[0]
              ? `example=${JSON.stringify(spec.examples[0].args)}`
              : 'example=none'
            return `- ${spec.name}: whenToUse=${spec.whenToUse}; requiredArgs=[${requiredArgs || 'none'}]; ${example}`
          })
          .join('\n')
      : 'none'

  return [
    `<catalog>\n${catalogText}\n</catalog>`,
    `<learned>\n${learnedDetailText}\n</learned>`,
    `<learned_tool_specs>\n${learnedToolSpecText}\n</learned_tool_specs>`
  ].join('\n')
}

const buildRecentDecisionHistoryText = (state: HumanState): string => {
  if (state.brainMemory.outside.brainDecisions.length === 0) return 'none'
  return state.brainMemory.outside.brainDecisions
    .map((record, index) => {
      const ordinal = index + 1
      const action = record.nextAction.action
      const nextActionPayload =
        action === 'learning'
          ? `wantLearnSkillIds=${record.nextAction.wantLearnSkillIds.join(',')}`
          : action === 'hand'
            ? `parallelCallToolParam=${JSON.stringify(record.nextAction.parallelCallToolParam)}`
            : `status=${record.nextAction.status}`

      return `- 第${ordinal}轮（createdAt=${record.createdAt}）：决定“${record.decision.summary}”；原因：${record.decision.reason}；预期结果：${record.decision.expectedOutcome}；nextAction.action=${action}；nextAction数据：${nextActionPayload}`
    })
    .join('\n')
}

export const buildBrainPromptContext = (state: HumanState) =>
  buildHumanBrainPrompt({
    userInput: state.task.userInput,
    memorySnapshotText: toJsonText(state.brainMemory.inside),
    skillContextText: buildSkillContextText(state),
    recentToolResultsText: toJsonText(state.lastParallelCallToolResults, 'none'),
    recentDecisionHistoryText: buildRecentDecisionHistoryText(state),
    watchHintText: state.watchHint || 'none'
  })
