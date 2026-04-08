import { renderInlineList } from '../../utils/render'
import {
  DELIVERY_MODE_PROMPT_EXAMPLES,
  DELIVERY_MODE_PROMPT_RULES
} from '../shared/deliveryContracts'
import { getLastRoundFocus } from '../memory/roundHistory'
import { renderHumanStableNotes } from '../shared/memoryRenderers'
import { renderHumanArtifactLines } from '../shared/runtimeRenderers'
import type { HumanDeliveryMode, HumanRoundRecord, HumanState } from '../types'
import { renderWatchHintForMouth } from './watchHints'

const renderRecentProgressSection = (record: HumanRoundRecord | undefined): string => {
  if (!record) {
    return 'none'
  }

  const progressText =
    record.execution.kind === 'pre_execution_blocked'
      ? `- 执行前阻断：${renderWatchHintForMouth(record.execution.watchHint)}`
      : record.execution.kind === 'learning'
        ? `- learning 结果：已加载 ${renderInlineList(
            record.execution.learningOutcome.loadedSkillIds.map((skillId) => `\`${skillId}\``),
            {
              separator: '、',
              fallback: 'none'
            }
          )}；重复 ${renderInlineList(
            record.execution.learningOutcome.skippedDuplicateSkillIds.map(
              (skillId) => `\`${skillId}\``
            ),
            {
              separator: '、',
              fallback: 'none'
            }
          )}；未知 ${renderInlineList(
            record.execution.learningOutcome.skippedUnknownSkillIds.map(
              (skillId) => `\`${skillId}\``
            ),
            {
              separator: '、',
              fallback: 'none'
            }
          )}。`
        : record.execution.kind === 'hand'
          ? `
- hand 执行模式：${record.execution.toolUsePlan.mode}
${record.execution.toolResults.map((result) => `- \`${result.toolName}\`：${result.summary}`).join('\n')}
`
              .trim()
              .replace(/\n\n+/g, '\n')
          : `- mouth 输出摘要：${record.execution.summary}`

  return `
- 第 ${record.roundId} 轮判断：${record.decision.decision.summary}
- 原因：${record.decision.decision.reason}
- 预期结果：${record.decision.decision.expectedOutcome}
${progressText}
`.trim()
}

const buildFinalDecisionText = (state: HumanState): string =>
  state.execution.currentDecision
    ? `最终决定（readyToDeliver=${String(state.execution.currentDecision.readyToDeliver)}）：“${state.execution.currentDecision.decision.summary}”；原因：${state.execution.currentDecision.decision.reason}；预期结果：${state.execution.currentDecision.decision.expectedOutcome}`
    : 'none'

export const buildMouthPrompt = (input: { state: HumanState; deliveryMode: HumanDeliveryMode }) => {
  const system = `
<system>
  <role>
    你现在扮演一个负责对外表达最终结果的人。
    你的任务是把已经确定下来的判断、任务笔记和产物整理成最终交付。
  </role>

  <working_style>
    请像一个表达清晰、判断克制的人一样输出结果：
    不夸大、不补编、不引入新的结论，
    只把已经确认的信息组织成最终交付。
  </working_style>

  <source_of_truth>
    - final_decision 是 brain 已经确认的最终判断；你负责表达，不负责重新推翻或改写它。
    - your_notes 是当前任务的稳定事实来源，包括已确认事实、关键依据和未决问题；正文中的事实与依据优先从这里取。
    - recent_progress 只用于补充最近完成到哪里、最近结果如何，不必把内部过程完整复述出来。
    - runtime_artifacts 只允许准确引用已经给出的路径、文件名、状态和摘要，不要补编额外元数据。
    - correction_hint 只用于如实说明限制、阻断或未完成点，不要把它扩写成新的事实。
  </source_of_truth>

  <context_block_guide>
    - delivery_mode：当前交付模式，决定结果面向谁，以及结果应该如何组织。
    - task_goal：用户原始诉求与限制。
    - final_decision：brain 已经确认的最终判断与收口方向。
    - your_notes：稳定任务笔记，按“已确认 / 关键依据 / 未决问题”组织。
    - recent_progress：最近一轮过程记录，用于补充当前完成到哪里。
    - runtime_artifacts：运行中已经产生的真实产物列表。
    - correction_hint：当前额外的收敛或纠偏提醒；若无则为 none。
  </context_block_guide>

  <delivery_principles>
    1. 如果任务已经完成，先直接给出结论，再给关键依据，再给结果或产物说明。
    2. 如果当前结果有限，先说明已经完成到哪里，再说明限制和继续需要什么。
    3. 只使用已经给你的任务笔记、最终判断和产物，不要补充新的事实或推理。
    4. 语言要清楚、克制、可执行，不要堆内部过程。
    5. 如果存在运行时产物或最近过程记录，只能准确引用已经给出的路径、状态和摘要。
    6. 你不会调用工具，也不会继续推进未完成步骤；如果仍有步骤没做，只能如实说明当前停在哪。
  </delivery_principles>

  <delivery_mode_rules>
${DELIVERY_MODE_PROMPT_RULES[input.deliveryMode]}
  </delivery_mode_rules>

  <output_contract>
    - 你必须只输出最终 markdown 正文，不要输出任何额外说明、JSON 或代码块。
    - 不要引入新的事实、依据、步骤或承诺。
    - 不要暴露内部字段名、节点名或系统术语。
    - 如果依据不足，就保持保守表达，不要写成确定结论。
    - 不要把未来可能执行的工具动作写成“后续会自动完成”或“已经在进行中”。
    - 输出必须是完整结果，而不是零散句子或局部片段。
  </output_contract>

  <output_example>
${DELIVERY_MODE_PROMPT_EXAMPLES[input.deliveryMode]}
  </output_example>
</system>
`.trim()

  const user = `
<user_context>
  <delivery_mode>
${input.deliveryMode}
  </delivery_mode>

  <task_goal>
${input.state.task.userInput}
  </task_goal>

  <final_decision>
${buildFinalDecisionText(input.state)}
  </final_decision>

  <your_notes>
${renderHumanStableNotes(input.state, 'mouth_prompt')}
  </your_notes>

  <recent_progress>
${renderRecentProgressSection(getLastRoundFocus(input.state))}
  </recent_progress>

  <runtime_artifacts>
${renderHumanArtifactLines(input.state, 'prompt')}
  </runtime_artifacts>

  <correction_hint>
${input.state.execution.watchHint ? renderWatchHintForMouth(input.state.execution.watchHint) : 'none'}
  </correction_hint>
</user_context>
`.trim()

  return {
    system,
    user
  }
}
