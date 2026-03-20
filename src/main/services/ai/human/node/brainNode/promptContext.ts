import { buildHumanBrainPrompt } from '../../prompts/brain'
import { getToolPromptSpec } from '../../prompts/toolPrompts'
import { getSkillDefinition } from '../learningNode/skillRegistry'
import type { HumanState } from '../../types'

const formatList = (items: string[]): string => (items.length > 0 ? items.join('\n') : 'none')

const buildMemorySnapshotText = (state: HumanState): string => {
  const factsText =
    state.brainMemory.inside.facts.length > 0
      ? state.brainMemory.inside.facts
          .map(
            (fact) =>
              `- fact(${fact.id})：${fact.summary}；evidenceIds=[${fact.evidenceIds.join(', ')}]`
          )
          .join('\n')
      : 'none'
  const evidencesText =
    state.brainMemory.inside.evidences.length > 0
      ? state.brainMemory.inside.evidences
          .map(
            (evidence) =>
              `- evidence(${evidence.id})：toolName=${evidence.toolName}；summary=${evidence.summary}${evidence.rawRef ? `；rawRef=${evidence.rawRef}` : ''}`
          )
          .join('\n')
      : 'none'
  const openQuestionsText =
    state.brainMemory.inside.openQuestions.length > 0
      ? state.brainMemory.inside.openQuestions.map((question) => `- ${question}`).join('\n')
      : 'none'

  return [
    'facts:',
    factsText,
    '',
    'evidences:',
    evidencesText,
    '',
    'openQuestions:',
    openQuestionsText
  ].join('\n')
}

const buildSkillContextText = (state: HumanState): string => {
  const catalogLines =
    state.brainMemory.outside.skillCatalog.length > 0
      ? state.brainMemory.outside.skillCatalog
          .map(
            (item) =>
              `- ${item.skillId}: ${item.summary}; tools=[${item.toolNames.join(', ')}]; whenToUse=${item.whenToUse}`
          )
      : ['none']
  const learnedDetailLines =
    state.brainMemory.outside.learnedSkillIds.length > 0
      ? state.brainMemory.outside.learnedSkillIds
          .map((skillId) => {
            const definition = getSkillDefinition(skillId)
            return `- ${definition.skillId}: ${definition.detail}`
          })
      : ['none']
  const learnedToolSpecLines =
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
              ? `exampleGoal=${spec.examples[0].goal}; exampleArgs=${Object.keys(spec.examples[0].args).join(', ') || 'none'}`
              : 'example=none'
            return `- ${spec.name}: whenToUse=${spec.whenToUse}; requiredArgs=[${requiredArgs || 'none'}]; ${example}`
          })
      : ['none']

  return [
    'catalog:',
    formatList(catalogLines),
    '',
    'learned skills:',
    formatList(learnedDetailLines),
    '',
    'tool specs:',
    formatList(learnedToolSpecLines)
  ].join('\n')
}

const buildRecentToolResultsText = (state: HumanState): string => {
  if (!state.lastParallelCallToolResults || state.lastParallelCallToolResults.length === 0) return 'none'
  return state.lastParallelCallToolResults
    .map(
      (result, index) =>
        `- 第${index + 1}项：toolName=${result.toolName}；ok=${result.ok ? 'true' : 'false'}；code=${result.code}；summary=${result.summary}`
    )
    .join('\n')
}

const buildRecentDecisionHistoryText = (state: HumanState): string => {
  if (state.brainMemory.outside.brainDecisions.length === 0) return 'none'
  return state.brainMemory.outside.brainDecisions
    .map((record, index) => {
      const ordinal = index + 1
      const action = record.nextAction.action
      const nextActionPayload =
        action === 'learning'
          ? `wantLearnSkillIds=[${record.nextAction.wantLearnSkillIds.join(',')}]`
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
    memorySnapshotText: buildMemorySnapshotText(state),
    skillContextText: buildSkillContextText(state),
    recentToolResultsText: buildRecentToolResultsText(state),
    recentDecisionHistoryText: buildRecentDecisionHistoryText(state),
    watchHintText: state.watchHint || 'none'
  })
