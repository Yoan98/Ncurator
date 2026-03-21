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
              `- 事实 ${fact.id}：${fact.summary}；支持证据=[${fact.evidenceIds.join(', ')}]`
          )
          .join('\n')
      : 'none'
  const evidencesText =
    state.brainMemory.inside.evidences.length > 0
      ? state.brainMemory.inside.evidences
          .map(
            (evidence) =>
              `- 证据 ${evidence.id}：来源工具 ${evidence.toolName}；摘要：${evidence.summary}${evidence.rawRef ? `；rawRef=${evidence.rawRef}` : ''}`
          )
          .join('\n')
      : 'none'
  const openQuestionsText =
    state.brainMemory.inside.openQuestions.length > 0
      ? state.brainMemory.inside.openQuestions.map((question) => `- ${question}`).join('\n')
      : 'none'

  return [
    '下面是你之前沉淀下来的记忆。这些内容代表当前已经确认、可以直接复用或仍影响推进的信息。',
    '',
    '已确认的事实：',
    factsText,
    '',
    '支撑这些事实的关键证据：',
    evidencesText,
    '',
    '仍未解决的问题：',
    openQuestionsText
  ].join('\n')
}

const buildSkillContextText = (state: HumanState): string => {
  const catalogLines =
    state.brainMemory.outside.skillCatalog.length > 0
      ? state.brainMemory.outside.skillCatalog
          .map(
            (item) =>
              `- ${item.skillId}：${item.summary}；可提供工具=[${item.toolNames.join(', ')}]；适用场景=${item.whenToUse}`
          )
      : ['none']
  const learnedSkillIdLines =
    state.brainMemory.outside.learnedSkillIds.length > 0
      ? state.brainMemory.outside.learnedSkillIds.map((skillId) => `- ${skillId}`)
      : ['none']
  const learnedDetailLines =
    state.brainMemory.outside.learnedSkillIds.length > 0
      ? state.brainMemory.outside.learnedSkillIds
          .map((skillId) => {
            const definition = getSkillDefinition(skillId)
            return `- ${definition.skillId}：${definition.detail}`
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
              ? `示例目标=${spec.examples[0].goal}；示例参数键=[${Object.keys(spec.examples[0].args).join(', ') || 'none'}]`
              : '示例=none'
            return `- 工具 ${spec.name}：适用场景=${spec.whenToUse}；必填参数=[${requiredArgs || 'none'}]；${example}`
          })
      : ['none']

  return [
    '下面是当前可用的技能信息。技能目录摘要只用于判断要不要学习；只有已学习 skill 的详细说明和工具要点，才代表你当前可以直接依赖的能力。',
    '',
    '当前可用技能目录摘要：',
    formatList(catalogLines),
    '',
    '已经学习的 skill id：',
    formatList(learnedSkillIdLines),
    '',
    '已学习技能的详细说明：',
    formatList(learnedDetailLines),
    '',
    '已学习技能对应的工具使用要点：',
    formatList(learnedToolSpecLines)
  ].join('\n')
}

const buildRecentToolResultsText = (state: HumanState): string => {
  const resultLines =
    state.lastParallelCallToolResults && state.lastParallelCallToolResults.length > 0
      ? state.lastParallelCallToolResults
          .map(
            (result, index) =>
              `- 第${index + 1}项：工具 ${result.toolName} ${result.ok ? '执行成功' : '执行失败'}（code=${result.code}）；摘要：${result.summary}`
          )
          .join('\n')
      : 'none'

  return [
    '下面是最近一轮工具调用刚带回来的新信息。请把这些结果和已有记忆一起判断，不要重复做同样的动作。',
    '',
    resultLines
  ].join('\n')
}

const buildRecentDecisionHistoryText = (state: HumanState): string => {
  const historyLines =
    state.brainMemory.outside.brainDecisions.length > 0
      ? state.brainMemory.outside.brainDecisions
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
      : 'none'

  return [
    '下面是最近几轮已经做过的正式判断摘要，只用于帮助你理解时间顺序并避免重复决策。',
    '',
    historyLines
  ].join('\n')
}

export const buildBrainPromptContext = (state: HumanState) =>
  buildHumanBrainPrompt({
    userInput: state.task.userInput,
    memorySnapshotText: buildMemorySnapshotText(state),
    skillContextText: buildSkillContextText(state),
    recentToolResultsText: buildRecentToolResultsText(state),
    recentDecisionHistoryText: buildRecentDecisionHistoryText(state),
    watchHintText: [
      '如果这里是 none，表示当前没有额外的收敛提醒；否则应优先考虑结束任务或纠偏。',
      '',
      state.watchHint || 'none'
    ].join('\n')
  })
