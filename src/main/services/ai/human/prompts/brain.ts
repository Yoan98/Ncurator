import { renderInlineList } from '../../utils/render'
import type { AiRunContext } from '../../types'
import { renderReferenceScopeText } from '../../prompts/referenceScope'
import {
  getHistoryChainRounds,
  getLastRoundFocus,
  getLoadedHistoryContext
} from '../memory/roundHistory'
import {
  getEffectiveLearnedSkillIds,
  getSkillDefinition,
  listBuiltinSkillDefinitions,
  listExternalSkillDefinitions
} from '../skills'
import { renderHumanStableNotes } from '../shared/memoryRenderers'
import { getToolPromptSpec } from '../tools/registry'
import type {
  HumanLoadedHistoryContext,
  HumanRoundRecord,
  HumanState,
  ToolPromptSpec
} from '../types'
import { renderWatchHintForBrain } from './watchHints'

const renderQuotedNames = (items: readonly string[]): string =>
  renderInlineList(
    items.map((item) => `\`${item}\``),
    {
      separator: '、',
      fallback: 'none'
    }
  )

const renderLearnedToolSpecLine = (spec: ToolPromptSpec): string => {
  const requiredArgs = spec.args
    .filter((arg) => arg.required)
    .map((arg) => `${arg.name}:${arg.type}`)
    .join(', ')
  const example = spec.examples?.[0]
    ? `示例目标=${spec.examples[0].goal}；示例参数键=[${Object.keys(spec.examples[0].args).join(', ') || 'none'}]`
    : '示例=none'

  return `- 工具 ${spec.name}：用途=${spec.purpose}；必填参数=[${requiredArgs || 'none'}]；${example}`
}

const renderDecisionNextAction = (record: HumanRoundRecord): string => {
  switch (record.decision.nextAction.action) {
    case 'learning':
      return `- 你准备下一步做：准备学习 ${renderQuotedNames(
        record.decision.nextAction.wantLearnSkillIds
      )}。`
    case 'hand':
      return `- 你准备下一步做：准备进入 hand，${
        record.decision.nextAction.toolUsePlan.mode === 'parallel'
          ? `以 parallel 模式并行执行 ${renderQuotedNames(
              record.decision.nextAction.toolUsePlan.calls.map((call) => call.toolName)
            )}。`
          : `以 serial 模式按顺序执行 ${renderQuotedNames(
              record.decision.nextAction.toolUsePlan.calls.map((call) => call.toolName)
            )}。`
      }`
    case 'mouth':
      return '- 你准备下一步做：准备进入 mouth 组织最终交付。'
  }
}

const renderRoundDecision = (record: HumanRoundRecord): string =>
  `
- 你的判断：${record.decision.decision.summary}
- 你这样判断的原因：${record.decision.decision.reason}
- 你当时期待的结果：${record.decision.decision.expectedOutcome}
- ${record.decision.readyToDeliver ? '你当时认为已经可以交付。' : '你当时认为还不能直接交付。'}
${renderDecisionNextAction(record)}
`.trim()

const renderRoundExecution = (
  record: HumanRoundRecord,
  detail: 'focus' | 'chain' | 'loaded'
): string => {
  switch (record.execution.kind) {
    case 'pre_execution_blocked':
      return '- 没有进入真实执行，系统在执行前阻断了这轮动作。'
    case 'learning':
      return '- 进入 learning，按请求尝试补齐外置技能。'
    case 'hand':
      return `
- 进入 hand，执行模式是 ${record.execution.toolUsePlan.mode}。
- ${
        record.execution.toolUsePlan.mode === 'parallel'
          ? `实际并行执行了 ${renderQuotedNames(record.execution.toolUsePlan.calls.map((call) => call.toolName))}。`
          : `实际按顺序执行了 ${renderQuotedNames(record.execution.toolUsePlan.calls.map((call) => call.toolName))}。`
      }
${detail !== 'chain' ? `- 本轮计划包含 ${record.execution.toolUsePlan.calls.length} 个工具调用。` : ''}
`
        .trim()
        .replace(/\n\n+/g, '\n')
    case 'mouth':
      return '- 进入 mouth，组织最终说明。'
  }
}

const renderRoundResult = (record: HumanRoundRecord): string => {
  switch (record.execution.kind) {
    case 'pre_execution_blocked':
      return renderWatchHintForBrain(record.execution.watchHint)
    case 'learning':
      return `
- 已加载的技能：${renderQuotedNames(record.execution.learningOutcome.loadedSkillIds)}
- 已跳过的重复技能：${renderQuotedNames(record.execution.learningOutcome.skippedDuplicateSkillIds)}
- 未识别的技能：${renderQuotedNames(record.execution.learningOutcome.skippedUnknownSkillIds)}
- 当前 active tool 数：${String(record.execution.learningOutcome.activeToolCount)}
${record.execution.watchHint ? `- 收敛提示：${renderWatchHintForBrain(record.execution.watchHint)}` : ''}
`
        .trim()
        .replace(/\n\n+/g, '\n')
    case 'hand': {
      const toolResultLines = record.execution.toolResults
        .map((result) =>
          [
            `- \`${result.toolName}\`：${result.summary}`,
            result.dataPreview ? `结果：${result.dataPreview}` : '',
            result.diagnosticText ? `诊断：${result.diagnosticText}` : ''
          ]
            .filter(Boolean)
            .join('；')
        )
        .join('\n')
      const artifactLine =
        record.execution.artifactRefs && record.execution.artifactRefs.length > 0
          ? `- 产物：${renderInlineList(
              record.execution.artifactRefs.map((artifact) =>
                artifact.kind === 'file'
                  ? `\`${artifact.fileName}\``
                  : `draft review ${artifact.review.reviewId}`
              ),
              {
                separator: '、',
                fallback: 'none'
              }
            )}`
          : ''
      const watchHintLine = record.execution.watchHint
        ? `- 收敛提示：${renderWatchHintForBrain(record.execution.watchHint)}`
        : ''

      return [toolResultLines, artifactLine, watchHintLine].filter(Boolean).join('\n')
    }
    case 'mouth':
      return `
- 输出摘要：${record.execution.summary}
${record.execution.completed ? '- 任务已完成。' : '- 任务未完成。'}
`.trim()
  }
}

const renderRoundRecord = (
  record: HumanRoundRecord,
  detail: 'focus' | 'chain' | 'loaded'
): string =>
  `
- 第 ${record.roundId} 轮

决策了什么：
${renderRoundDecision(record)}

做了什么：
${renderRoundExecution(record, detail)}

结果是什么：
${renderRoundResult(record)}
`.trim()

const renderRoundSection = (input: {
  records: HumanRoundRecord[]
  detail: 'focus' | 'chain' | 'loaded'
}): string =>
  input.records.length > 0
    ? input.records.map((record) => renderRoundRecord(record, input.detail)).join('\n\n')
    : 'none'

const renderLoadedHistoryText = (
  loadedHistoryContext: HumanLoadedHistoryContext | undefined
): string =>
  loadedHistoryContext
    ? `
过滤条件：roundIds=${renderInlineList((loadedHistoryContext.filters.roundIds || []).map(String), {
        separator: '、',
        fallback: 'none'
      })}；executionKinds=${renderInlineList(loadedHistoryContext.filters.executionKinds || [], {
        separator: '、',
        fallback: 'none'
      })}；toolNames=${renderInlineList(loadedHistoryContext.filters.toolNames || [], {
        separator: '、',
        fallback: 'none'
      })}；watchHintCodes=${renderInlineList(loadedHistoryContext.filters.watchHintCodes || [], {
        separator: '、',
        fallback: 'none'
      })}；limit=${String(loadedHistoryContext.filters.limit || loadedHistoryContext.rounds.length)}

${renderRoundSection({
  records: loadedHistoryContext.rounds,
  detail: 'loaded'
})}
`
        .trim()
    : 'none'

const renderAvailableSkillsSection = (state: HumanState): string => {
  const effectiveSkillIds = getEffectiveLearnedSkillIds(state.skills.learnedSkillIds)
  const effectiveSkillDefinitions = effectiveSkillIds.map((skillId) => getSkillDefinition(skillId))
  const learnedExternalSkillDefinitions = effectiveSkillDefinitions.filter(
    (definition) => definition.source === 'external'
  )
  const learnableSkillLines = listExternalSkillDefinitions()
    .filter((definition) => !state.skills.learnedSkillIds.includes(definition.skillId))
    .map(
      (definition) =>
        `- ${definition.skillId}：${definition.summary}；可提供工具=[${definition.toolNames.join(', ')}]；适用场景=${definition.whenToUse}`
    )
  const effectiveToolSpecLines = Array.from(
    new Set(effectiveSkillDefinitions.flatMap((definition) => definition.toolNames))
  )
    .map((toolName) => getToolPromptSpec(toolName))
    .filter((spec): spec is ToolPromptSpec => Boolean(spec))
    .map(renderLearnedToolSpecLine)

  return `
始终可用的技能：
${
  listBuiltinSkillDefinitions()
    .map(
      (definition) =>
        `- ${definition.skillId}：${definition.summary}；适用场景=${definition.whenToUse}`
    )
    .join('\n') || 'none'
}

已经学习的技能：
${
  learnedExternalSkillDefinitions
    .map(
      (definition) =>
        `- ${definition.skillId}：${definition.detail}；可提供工具=[${definition.toolNames.join(', ')}]`
    )
    .join('\n') || 'none'
}

仍可补充学习的技能：
${learnableSkillLines.join('\n') || 'none'}

当前可直接调用的工具：
${effectiveToolSpecLines.join('\n') || 'none'}
`.trim()
}

export const buildBrainPrompt = (input: { state: HumanState; ctx: AiRunContext }) => {
  const system = `
<system>
  <role>
    你现在扮演一个负责理解任务、审视记忆并决定下一步动作的大脑角色。
    你的职责是判断任务当前处在什么阶段，以及 learning、hand、mouth 中哪一步最合适。
  </role>

  <working_style>
    请像一个判断稳定的人类执行者一样工作：
    理解任务目标，结合当前记忆、真实执行结果和可用能力，自主判断下一步。
    不编造事实、证据、能力或工具结果。
  </working_style>

  <autonomy_principles>
    - 你会收到任务、记忆、技能、历史和提示等不同类型的信息。
    - 这些信息是提供给你判断当前局面的参考材料，不是固定流程。
    - 你需要自行判断哪些信息重要、哪些信息只是背景，以及下一步最合适的动作。
    - 除了明确写出的职责边界、输出契约和硬约束，不要把上下文说明理解成固定操作指令。
  </autonomy_principles>

  <action_boundaries>
    - 你只负责判断下一步，不亲自补能力、执行工具或直接对用户表达。
    - learning 只负责补齐当前真正缺失的技能说明。
    - hand 只负责执行已经决定好的工具计划。
    - mouth 只负责整理最终结果，不新增事实，不继续执行工具。
  </action_boundaries>

  <transition_contract>
    - nextAction 只能在 learning、hand、mouth 三者中选择其一。
    - 选择 learning：当你已经知道缺少哪类能力说明，且补齐后能明显降低不确定性时。
    - 选择 hand：当下一步已经明确成一批工具调用，且你能给出完整合法的 toolUsePlan 时。
    - 如果你现在无法给出某个工具的完整必填参数，不要猜；应改为 learning 或 mouth。
    - hand 的 toolUsePlan 单轮只能选择一种 mode。只有只读且彼此独立、并行安全的动作才用 parallel；其余情况必须用 serial。
    - 如果结果仍依赖未来的工具动作才能完成，readyToDeliver 必须为 false，且不能选择 mouth。
    - 选择 mouth：只在 readyToDeliver=true 且当前已经足够形成最终交付时。
  </transition_contract>

  <context_block_guide>
    - task_goal：用户原始诉求与限制。
    - reference_scope：当前工作区、默认知识范围、显式缩圈范围和可用边界。
    - your_notes：稳定任务笔记，按“已确认 / 关键依据 / 未决问题”组织。
    - recent_progress：最近一轮完整过程记录，用于判断刚做了什么、得到什么。
    - earlier_attempts：更早轮次过程链，用于识别重复路径、失败模式和已经验证过的动作。
    - recalled_history：主动回看的详细历史；只有明确回看后才会出现，并可能附带过滤条件。
    - available_skills：当前已生效或仍可学习的 skills，以及当前可直接调用的工具说明。
    - correction_hint：当前额外的收敛或纠偏提示；若无则为 none。
  </context_block_guide>

  <output_contract>
    - 你必须只输出 JSON，不要输出任何额外说明，也不要输出 markdown。
    - 输出顶层结构固定为：
      {
        "updatedStableMemory"?: {
          "confirmedFacts"?: "string",
          "keyEvidence"?: "string",
          "openQuestions"?: "string"
        },
        "decision": {
          "summary": "string",
          "reason": "string",
          "expectedOutcome": "string"
        },
        "readyToDeliver": "boolean",
        "nextAction":
          | { "action": "learning", "wantLearnSkillIds": ["skill-id"] }
          | { "action": "hand", "toolUsePlan": { "mode": "parallel|serial", "calls": [{ "toolName": "tool_name", "args": {} }] } }
          | { "action": "mouth" }
      }
    - updatedStableMemory 是可选的 partial patch；缺失表示本轮不更新任务笔记。
    - updatedStableMemory 中某个字段缺失：表示该字段保持原值。
    - updatedStableMemory 中某个字段为空字符串：表示显式清空该字段。
    - updatedStableMemory.confirmedFacts：只写当前已经确认、可以直接成立的事实。
    - updatedStableMemory.keyEvidence：只写支撑事实的关键依据、证据来源或命中摘要。
    - updatedStableMemory.openQuestions：只写仍阻碍收敛的未知点、限制或待确认项。
    - decision.summary：一句话概括你本轮的判断或下一步意图。
    - decision.reason：说明你为什么这样判断，必须基于已给上下文、记忆或真实结果。
    - decision.expectedOutcome：说明你希望下一跳拿到什么结果，帮助后续节点收敛。
    - readyToDeliver=true 只表示当前已经具备最终交付所需的信息、证据和产物。
    - nextAction 只能输出一种合法结构：learning、hand 或 mouth。
    - hand.toolUsePlan.mode：parallel 只用于只读且彼此独立、并行安全的调用；其余情况必须用 serial。
    - hand.toolUsePlan.calls[*].toolName：必须严格使用当前工具说明里的精确名称。
    - hand.toolUsePlan.calls[*].args：必须是对象，字段名、必填参数和参数层级都必须与工具说明一致。
  </output_contract>

  <examples>
    <example_keep_notes>
      {
        "decision": {
          "summary": "先学习当前缺失的技能",
          "reason": "下一步已经明确，但仍缺少相关技能说明。",
          "expectedOutcome": "补齐技能说明后可以决定是否调用工具。"
        },
        "readyToDeliver": false,
        "nextAction": {
          "action": "learning",
          "wantLearnSkillIds": ["docx-read"]
        }
      }
    </example_keep_notes>

    <example_tool_plan>
      {
        "decision": {
          "summary": "下一步已经明确，准备执行真实工具调用。",
          "reason": "当前已具备所需能力，且已经能写出完整合法的工具参数。",
          "expectedOutcome": "拿到当前工作区路径，供后续判断继续使用。"
        },
        "readyToDeliver": false,
        "nextAction": {
          "action": "hand",
          "toolUsePlan": {
            "mode": "serial",
            "calls": [
              {
                "toolName": "terminal_run_command",
                "args": {
                  "command": "pwd"
                }
              }
            ]
          }
        }
      }
    </example_tool_plan>

    <example_partial_notes_update>
      {
        "updatedStableMemory": {
          "keyEvidence": "- kb_hybrid_search_chunks 命中了审批驳回时保留原文件的制度说明。",
          "openQuestions": ""
        },
        "decision": {
          "summary": "证据已经足够，准备结束任务",
          "reason": "当前已拿到能直接支撑结论的依据。",
          "expectedOutcome": "由后续表达节点整理最终结果。"
        },
        "readyToDeliver": true,
        "nextAction": {
          "action": "mouth"
        }
      }
    </example_partial_notes_update>
  </examples>
</system>
`.trim()

  const user = `
<user_context>
  <task_goal>
${input.state.task.userInput}
  </task_goal>

  <reference_scope>
${renderReferenceScopeText(input.ctx.referenceScope)}
  </reference_scope>

  <memory>
    <your_notes>
${renderHumanStableNotes(input.state, 'brain_prompt')}
    </your_notes>

    <recent_progress>
${renderRoundSection({
  records: getLastRoundFocus(input.state) ? [getLastRoundFocus(input.state)!] : [],
  detail: 'focus'
})}
    </recent_progress>

    <earlier_attempts>
${renderRoundSection({
  records: getHistoryChainRounds(input.state),
  detail: 'chain'
})}
    </earlier_attempts>

    <recalled_history>
${renderLoadedHistoryText(getLoadedHistoryContext(input.state))}
    </recalled_history>
  </memory>

  <available_skills>
${renderAvailableSkillsSection(input.state)}
  </available_skills>

  <correction_hint>
${input.state.execution.watchHint ? renderWatchHintForBrain(input.state.execution.watchHint) : 'none'}
  </correction_hint>
</user_context>
`.trim()

  return {
    system,
    user
  }
}
