import type { HumanState, ToolPromptSpec } from '../types'
import { getToolPromptSpec } from './toolPrompts'
import { getSkillDefinition } from '../node/learningNode/skillRegistry'
import { renderLineList } from '../../utils/render'

const formatList = (items: string[]): string =>
  renderLineList(items, {
    fallback: 'none',
    style: 'plain'
  })

export const renderFactLines = (state: HumanState, mode: 'brain' | 'mouth'): string => {
  return renderLineList(
    state.brainMemory.inside.facts.map((fact) =>
      mode === 'brain'
        ? `- 事实 ${fact.id}：${fact.summary}；支持证据=[${fact.evidenceIds.join(', ')}]`
        : `- ${fact.summary} (evidenceIds=[${fact.evidenceIds.join(', ')}])`
    ),
    {
      fallback: 'none',
      style: 'plain'
    }
  )
}

export const renderEvidenceLines = (state: HumanState, mode: 'brain' | 'mouth'): string => {
  return renderLineList(
    state.brainMemory.inside.evidences.map((evidence) =>
      mode === 'brain'
        ? `- 证据 ${evidence.id}：来源工具 ${evidence.toolName}；摘要：${evidence.summary}${evidence.rawRef ? `；rawRef=${evidence.rawRef}` : ''}`
        : `- ${evidence.toolName}: ${evidence.summary}${evidence.rawRef ? ` (${evidence.rawRef})` : ''}`
    ),
    {
      fallback: 'none',
      style: 'plain'
    }
  )
}

export const renderOpenQuestionLines = (state: HumanState): string => {
  return renderLineList(
    state.brainMemory.inside.openQuestions.map((question) => `- ${question}`),
    {
      fallback: 'none',
      style: 'plain'
    }
  )
}

const renderLearnedToolSpecLine = (spec: ToolPromptSpec): string => {
  const requiredArgs = spec.args
    .filter((arg) => arg.required)
    .map((arg) => `${arg.name}:${arg.type}`)
    .join(', ')
  const example = spec.examples?.[0]
    ? `示例目标=${spec.examples[0].goal}；示例参数键=[${Object.keys(spec.examples[0].args).join(', ') || 'none'}]`
    : '示例=none'

  return `- 工具 ${spec.name}：适用场景=${spec.whenToUse}；必填参数=[${requiredArgs || 'none'}]；${example}`
}

const renderSkillCatalogLines = (state: HumanState): string[] =>
  state.brainMemory.outside.skillCatalog.length > 0
    ? state.brainMemory.outside.skillCatalog.map(
        (item) =>
          `- ${item.skillId}：${item.summary}；可提供工具=[${item.toolNames.join(', ')}]；适用场景=${item.whenToUse}`
      )
    : ['none']

const renderLearnedSkillIdLines = (state: HumanState): string[] =>
  state.brainMemory.outside.learnedSkillIds.length > 0
    ? state.brainMemory.outside.learnedSkillIds.map((skillId) => `- ${skillId}`)
    : ['none']

const renderLearnedSkillDetailLines = (state: HumanState): string[] =>
  state.brainMemory.outside.learnedSkillIds.length > 0
    ? state.brainMemory.outside.learnedSkillIds.map((skillId) => {
        const definition = getSkillDefinition(skillId)
        return `- ${definition.skillId}：${definition.detail}`
      })
    : ['none']

const renderLearnedToolSpecLines = (state: HumanState): string[] => {
  if (state.brainMemory.outside.learnedSkillIds.length === 0) return ['none']

  return state.brainMemory.outside.learnedSkillIds
    .flatMap((skillId) => getSkillDefinition(skillId).toolNames)
    .map((toolName) => getToolPromptSpec(toolName))
    .filter((spec): spec is ToolPromptSpec => Boolean(spec))
    .map(renderLearnedToolSpecLine)
}

export const buildMemorySnapshotText = (state: HumanState): string => {
  return [
    '下面是你之前沉淀下来的记忆。这些内容代表当前已经确认、可以直接复用或仍影响推进的信息。',
    '',
    '已确认的事实：',
    renderFactLines(state, 'brain'),
    '',
    '支撑这些事实的关键证据：',
    renderEvidenceLines(state, 'brain'),
    '',
    '仍未解决的问题：',
    renderOpenQuestionLines(state)
  ].join('\n')
}

export const buildSkillContextText = (state: HumanState): string => {
  return [
    '下面是当前可用的技能信息。技能目录摘要只用于判断要不要学习；只有已学习 skill 的详细说明和工具要点，才代表你当前可以直接依赖的能力。',
    '',
    '当前可用技能目录摘要：',
    formatList(renderSkillCatalogLines(state)),
    '',
    '已经学习的 skill id：',
    formatList(renderLearnedSkillIdLines(state)),
    '',
    '已学习技能的详细说明：',
    formatList(renderLearnedSkillDetailLines(state)),
    '',
    '已学习技能对应的工具使用要点：',
    formatList(renderLearnedToolSpecLines(state))
  ].join('\n')
}

export const buildRecentToolResultsText = (state: HumanState): string => {
  const resultLines = renderLineList(
    (state.lastParallelCallToolResults || []).map(
      (result, index) =>
        `- 第${index + 1}项：工具 ${result.toolName} ${result.ok ? '执行成功' : '执行失败'}（code=${result.code}）；摘要：${result.summary}`
    ),
    {
      fallback: 'none',
      style: 'plain'
    }
  )

  return [
    '下面是最近一轮工具调用刚带回来的新信息。请把这些结果和已有记忆一起判断，不要重复做同样的动作。',
    '',
    resultLines
  ].join('\n')
}

export const buildRecentDecisionHistoryText = (state: HumanState): string => {
  const historyLines = renderLineList(
    state.brainMemory.outside.brainDecisions.map((record, index) => {
      const ordinal = index + 1
      const action = record.nextAction.action
      const nextActionPayload =
        action === 'learning'
          ? `wantLearnSkillIds=[${record.nextAction.wantLearnSkillIds.join(',')}]`
          : action === 'hand'
            ? `parallelCallToolParam=${JSON.stringify(record.nextAction.parallelCallToolParam)}`
            : `status=${record.nextAction.status}`

      return `- 第${ordinal}轮（createdAt=${record.createdAt}）：决定“${record.decision.summary}”；原因：${record.decision.reason}；预期结果：${record.decision.expectedOutcome}；nextAction.action=${action}；nextAction数据：${nextActionPayload}`
    }),
    {
      fallback: 'none',
      style: 'plain'
    }
  )

  return [
    '下面是最近几轮已经做过的正式判断摘要，只用于帮助你理解时间顺序并避免重复决策。',
    '',
    historyLines
  ].join('\n')
}
