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
    return `
这是最近一轮过程记录。

none
`.trim()
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
这是最近一轮过程记录。

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

  <output_rules>
    你必须只输出最终 markdown 正文，不要输出任何额外说明，不要包 JSON，不要包代码块。
  </output_rules>

  <output_principles>
    - 不要引入新的事实、依据、步骤或承诺。
    - 不要暴露内部字段名、节点名或系统术语。
    - 如果依据不足，就保持保守表达，不要写成确定结论。
    - 不要把未来可能执行的工具动作写成“后续会自动完成”或“已经在进行中”。
    - 输出必须是完整结果，而不是零散句子或局部片段。
  </output_principles>

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
