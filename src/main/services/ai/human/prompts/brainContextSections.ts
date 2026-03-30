import type { AiRunContext } from '../../types'
import type { HumanState, ToolPromptSpec } from '../types'
import { getSkillDefinition } from '../skills'
import { getToolPromptSpec } from '../tools/registry'
import { renderLineList } from '../../utils/render'
import {
  renderHumanEvidenceLines,
  renderHumanFactLines,
  renderHumanOpenQuestionLines
} from '../shared/memoryRenderers'

const formatList = (items: string[]): string =>
  renderLineList(items, {
    fallback: 'none',
    style: 'plain'
  })

type BrainPromptRenderView = {
  factLines: string
  evidenceLines: string
  openQuestionLines: string
  runConstraintsLines: string[]
  skillCatalogLines: string[]
  learnedSkillIdLines: string[]
  learnedSkillDetailLines: string[]
  learnedToolSpecLines: string[]
  recentToolResultLines: string
  recentDecisionHistoryLines: string
}

export type BrainPromptSections = {
  memorySnapshotText: string
  runConstraintsText: string
  skillContextText: string
  recentToolResultsText: string
  recentDecisionHistoryText: string
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

const buildRecentToolResultLine = (
  result: NonNullable<HumanState['lastParallelCallToolResults']>[number],
  index: number
): string => {
  const diagnosticText = result.diagnostic
    ? `；diagnostic=${result.diagnostic.kind}${result.diagnostic.missingArgs?.length ? `；missingArgs=[${result.diagnostic.missingArgs.join(', ')}]` : ''}`
    : ''
  return `- 第${index + 1}项：工具 ${result.toolName} ${result.ok ? '执行成功' : '执行失败'}（code=${result.code}）；摘要：${result.summary}${diagnosticText}`
}

const buildRunConstraintsLines = (ctx: AiRunContext): string[] => {
  const selectedDocumentCount = ctx.selectedDocumentIds?.length || 0
  return [
    '- 当前运行约束来自系统运行态，不是用户额外说明。',
    `- 资料范围摘要：${ctx.selectedScopeSummary.replace(/\n/g, ' | ')}`,
    `- 已选文档数：${selectedDocumentCount}`,
    ctx.workspace
      ? '- 工作区：已绑定；若确实需要访问文件，请使用工作区内相对路径。'
      : '- 工作区：未绑定；不要依赖 terminal 或 docx workspace 能力。',
    `- 允许非本地信息：${ctx.allowNonLocal ? '是' : '否'}`
  ]
}

const buildBrainPromptRenderView = (input: {
  state: HumanState
  ctx: AiRunContext
}): BrainPromptRenderView => {
  const { state, ctx } = input
  const learnedSkillIds = state.brainMemory.outside.learnedSkillIds
  const learnedSkillDefinitions = learnedSkillIds.map((skillId) => getSkillDefinition(skillId))
  const learnedToolNames = Array.from(
    new Set(learnedSkillDefinitions.flatMap((definition) => definition.toolNames))
  )
  const learnedToolSpecLines =
    learnedToolNames.length > 0
      ? learnedToolNames
          .map((toolName) => getToolPromptSpec(toolName))
          .filter((spec): spec is ToolPromptSpec => Boolean(spec))
          .map(renderLearnedToolSpecLine)
      : ['none']

  const recentToolResultLines = renderLineList(
    (state.lastParallelCallToolResults || []).map((result, index) =>
      buildRecentToolResultLine(result, index)
    ),
    {
      fallback: 'none',
      style: 'plain'
    }
  )

  const recentDecisionHistoryLines = renderLineList(
    state.brainMemory.outside.brainDecisions.map((record, index) => {
      const ordinal = index + 1
      const action = record.nextAction.action
      const nextActionPayload =
        action === 'learning'
          ? `wantLearnSkillIds=[${record.nextAction.wantLearnSkillIds.join(',')}]`
          : action === 'hand'
            ? `parallelCallToolParam=${JSON.stringify(record.nextAction.parallelCallToolParam)}`
            : 'final_delivery=true'

      return `- 第${ordinal}轮（createdAt=${record.createdAt}）：决定“${record.decision.summary}”；原因：${record.decision.reason}；预期结果：${record.decision.expectedOutcome}；nextAction.action=${action}；nextAction数据：${nextActionPayload}`
    }),
    {
      fallback: 'none',
      style: 'plain'
    }
  )

  return {
    factLines: renderHumanFactLines(state, 'brain_prompt'),
    evidenceLines: renderHumanEvidenceLines(state, 'brain_prompt'),
    openQuestionLines: renderHumanOpenQuestionLines(state, 'brain_prompt'),
    runConstraintsLines: buildRunConstraintsLines(ctx),
    skillCatalogLines:
      state.brainMemory.outside.skillCatalog.length > 0
        ? state.brainMemory.outside.skillCatalog.map(
            (item) =>
              `- ${item.skillId}：${item.summary}；可提供工具=[${item.toolNames.join(', ')}]；适用场景=${item.whenToUse}`
          )
        : ['none'],
    learnedSkillIdLines:
      learnedSkillIds.length > 0 ? learnedSkillIds.map((skillId) => `- ${skillId}`) : ['none'],
    learnedSkillDetailLines:
      learnedSkillDefinitions.length > 0
        ? learnedSkillDefinitions.map((definition) => `- ${definition.skillId}：${definition.detail}`)
        : ['none'],
    learnedToolSpecLines,
    recentToolResultLines,
    recentDecisionHistoryLines
  }
}

export const buildBrainPromptSections = (input: {
  state: HumanState
  ctx: AiRunContext
}): BrainPromptSections => {
  const view = buildBrainPromptRenderView(input)

  return {
    memorySnapshotText: [
      '下面是你之前沉淀下来的记忆。这些内容代表当前已经确认、可以直接复用或仍影响推进的信息。',
      '',
      '已确认的事实：',
      view.factLines,
      '',
      '支撑这些事实的关键证据：',
      view.evidenceLines,
      '',
      '仍未解决的问题：',
      view.openQuestionLines
    ].join('\n'),
    runConstraintsText: [
      '下面是本次运行的固定边界。它们是当前任务真实可用范围的一部分，决策时必须一起考虑。',
      '',
      formatList(view.runConstraintsLines)
    ].join('\n'),
    skillContextText: [
      '下面是当前可用的技能信息。技能目录摘要只用于判断要不要学习；只有已学习 skill 的详细说明和工具要点，才代表你当前可以直接依赖的能力。',
      '',
      '当前可用技能目录摘要：',
      formatList(view.skillCatalogLines),
      '',
      '已经学习的 skill id：',
      formatList(view.learnedSkillIdLines),
      '',
      '已学习技能的详细说明：',
      formatList(view.learnedSkillDetailLines),
      '',
      '已学习技能对应的工具使用要点：',
      formatList(view.learnedToolSpecLines)
    ].join('\n'),
    recentToolResultsText: [
      '下面是最近一轮工具调用刚带回来的新信息。请把这些结果和已有记忆一起判断，不要重复做同样的动作。',
      '',
      view.recentToolResultLines
    ].join('\n'),
    recentDecisionHistoryText: [
      '下面是最近几轮已经做过的正式判断摘要，只用于帮助你理解时间顺序并避免重复决策。',
      '',
      view.recentDecisionHistoryLines
    ].join('\n')
  }
}
