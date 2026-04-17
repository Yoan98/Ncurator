import type { AiRunContext } from '../../types'
import { renderReferenceScopeText } from '../../prompts/referenceScope'
import {
  getEarlierAttemptRounds,
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
import { renderLoadedHistoryText, renderRoundSection } from '../shared/historyRenderers'
import { getToolSpec } from '../tools/registry'
import { renderBrainOutputSchemaForPrompt, renderToolSchemaForPrompt } from '../tools/schemaPromptRenderer'
import { humanDecisionSchema } from '../schema'
import type {
  HumanState,
  ToolPromptExample
} from '../types'
import type { HumanToolSpec } from '../tools/types'
import { renderWatchHintForBrain } from './watchHints'

const renderToolExample = (example: ToolPromptExample, index: number): string =>
  `${index + 1}. ${example.goal}\n${JSON.stringify(example.args, null, 2)}`

const indentLines = (value: string, level: number): string =>
  value
    .split('\n')
    .map((line) => `${'  '.repeat(level)}${line}`)
    .join('\n')

const renderLearnedToolSpecLine = (spec: HumanToolSpec): string => {
  const preconditions = spec.promptSpec.preconditions?.join(' / ') || 'none'
  const returns = spec.promptSpec.returns.map((item) => item.name).join(', ') || 'none'
  const schemaText = indentLines(renderToolSchemaForPrompt(spec.schema), 2)
  const examples = indentLines(spec.promptSpec.examples.map(renderToolExample).join('\n'), 2)

  return `
- 工具 ${spec.name}
  - 用途：${spec.promptSpec.purpose}
  - 前置条件：${preconditions}
  - 核心返回：${returns}
  - 结构：
${schemaText}
  - 示例：
${examples}
`.trim()
}

const renderPlatformText = (ctx: AiRunContext): string => `当前 terminal 平台：${ctx.platform}`

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
        `- ${definition.skillId}：${definition.description}；可提供工具=[${definition.toolNames.join(', ')}]；适用场景=${definition.whenToUse}`
    )
  const effectiveToolSpecLines = Array.from(
    new Set(effectiveSkillDefinitions.flatMap((definition) => definition.toolNames))
  )
    .map((toolName) => getToolSpec(toolName))
    .filter((spec): spec is HumanToolSpec => Boolean(spec))
    .map(renderLearnedToolSpecLine)

  return `
始终可用的技能：
${
  listBuiltinSkillDefinitions()
    .map(
      (definition) =>
        `- ${definition.skillId}：${definition.description}；适用场景=${definition.whenToUse}`
    )
    .join('\n') || 'none'
}

已经学习的技能：
${
  learnedExternalSkillDefinitions
    .map(
      (definition) =>
        `- ${definition.skillId}：${definition.description}；可提供工具=[${definition.toolNames.join(', ')}]；适用场景=${definition.whenToUse}`
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
  const outputShapeText = indentLines(renderBrainOutputSchemaForPrompt(humanDecisionSchema), 1)
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
    当存在工作区或显式参考资料时，默认优先使用这些本地信息来理解和完成任务。
  </working_style>

  <autonomy_principles>
    - 你会收到任务、记忆、技能、历史和提示等不同类型的信息。
    - 这些信息是提供给你判断当前局面的参考材料，不是固定流程。
    - 你需要自行判断哪些信息重要、哪些信息只是背景，以及下一步最合适的动作。
    - 除了明确写出的职责边界、输出契约和硬约束，不要把上下文说明理解成固定操作指令。
    - 如果最终交付必须补充不来自本地资料的模型常识，应在收口时明确说明这些补充点不来自当前本地资料。
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
    - terminal_platform：当前 terminal 所在平台；如果你决定使用命令行，应据此选择命令语法。
    - your_notes：稳定任务笔记，按“当前理解 / 关键依据 / 检查清单”组织。
    - recent_progress：最近一轮完整过程记录，用于判断刚做了什么、得到什么。
    - earlier_attempts：更早轮次过程链，用于识别重复路径、失败模式和已经验证过的动作。
    - recalled_history：主动回看的详细历史；只有明确回看后才会出现，并可能附带过滤条件。
    - available_skills：当前已生效或仍可学习的 skills，以及当前可直接调用的工具说明。
    - correction_hint：当前额外的收敛或纠偏提示；若无则为 none。
  </context_block_guide>

  <output_rules>
    - 你必须只输出 JSON，不要输出任何额外说明，也不要输出 markdown。
    - updatedStableMemory 是可选的 partial patch；缺失表示本轮不更新任务笔记。
    - updatedStableMemory 中某个字段缺失：表示该字段保持原值。
    - updatedStableMemory 中某个字段为空字符串：表示显式清空该字段。
    - stableMemory 是长期记忆，不是本轮摘要。
    - 如果你输出某个 stableMemory 字段，表示你给出了该字段基于旧内容累积编辑后的完整最新版本。
    - 旧内容中仍然有效的信息不能因为本轮未提及而静默丢失；如果旧判断需要修正，应直接在该字段的新版本里改正。
    - updatedStableMemory.currentUnderstanding：写当前任务的最新长期理解，可包含已确认事实、当前判断和关键限制。
    - updatedStableMemory.keyEvidence：写支撑当前理解的关键依据、来源或命中摘要，并基于旧内容累积维护。
    - updatedStableMemory.checklist：写当前任务板，使用 markdown 清单维护 todo / done / obsolete 三种状态；每条都必须带 note。
    - checklist 示例格式：
      - [todo] 事项标题
        - note: 补充说明
      - [done] 事项标题
        - note: 完成依据或结果
      - [obsolete] 事项标题
        - note: 为什么这条路径失效或不再优先
    - decision.summary：一句话概括你本轮的判断或下一步意图。
    - decision.reason：说明你为什么这样判断，必须基于已给上下文、记忆或真实结果。
    - decision.expectedOutcome：说明你希望下一跳拿到什么结果，帮助后续节点收敛。
    - readyToDeliver=true 只表示当前已经具备最终交付所需的信息、证据和产物。
    - 即使 checklist 里仍有未完成项，你仍可选择 mouth；但如果这样做，decision.reason 必须明确说明这些未完成项为何已不再阻塞最终交付。
    - nextAction 只能输出一种合法结构：learning、hand 或 mouth。
    - hand.toolUsePlan.mode：parallel 只用于只读且彼此独立、并行安全的调用；其余情况必须用 serial。
    - hand.toolUsePlan.calls[*].toolName：必须严格使用当前工具说明里的精确名称。
    - hand.toolUsePlan.calls[*].args：必须是对象，字段名、必填参数和参数层级都必须与工具说明一致。
  </output_rules>

  <output_shape>
${outputShapeText}
  </output_shape>

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
                "toolName": "workspace_run_command",
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
          "currentUnderstanding": "- 已确认审批驳回时原文件保持不变。",
          "keyEvidence": "- kb_search 命中了审批驳回时保留原文件的制度说明。",
          "checklist": "- [done] 确认审批驳回时是否保留原文件\\n  - note: 已从知识库命中制度说明。"
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

  <terminal_platform>
${renderPlatformText(input.ctx)}
  </terminal_platform>

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
  records: getEarlierAttemptRounds(input.state),
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
