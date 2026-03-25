import type { HumanDeliveryMode, HumanState } from '../types'
import {
  buildDeliveryModePromptExample,
  buildDeliveryModePromptRules
} from '../shared/deliveryContracts'
import {
  renderHumanEvidenceLines,
  renderHumanFactLines,
  renderHumanOpenQuestionLines
} from '../shared/memoryRenderers'
import {
  renderHumanArtifactLines,
  renderHumanRecentToolResultLines
} from '../shared/runtimeRenderers'

type HumanMouthPromptInput = {
  deliveryMode: HumanDeliveryMode
  userInput: string
  finalDecisionText: string
  factsText: string
  evidencesText: string
  openQuestionsText: string
  recentToolResultsText: string
  runtimeArtifactsText: string
  watchHintText: string
}

const buildFinalDecisionText = (state: HumanState): string =>
  state.lastBrainDecision
    ? `最终决定：“${state.lastBrainDecision.decision.summary}”；原因：${state.lastBrainDecision.decision.reason}；预期结果：${state.lastBrainDecision.decision.expectedOutcome}`
    : 'none'

export const buildMouthPromptContext = (input: {
  state: HumanState
  deliveryMode: HumanDeliveryMode
}) => {
  return buildHumanMouthPrompt({
    deliveryMode: input.deliveryMode,
    userInput: input.state.task.userInput,
    finalDecisionText: buildFinalDecisionText(input.state),
    factsText: renderHumanFactLines(input.state, 'mouth_prompt'),
    evidencesText: renderHumanEvidenceLines(input.state, 'mouth_prompt'),
    openQuestionsText: renderHumanOpenQuestionLines(input.state, 'mouth_prompt'),
    recentToolResultsText: renderHumanRecentToolResultLines(input.state, 'prompt'),
    runtimeArtifactsText: renderHumanArtifactLines(input.state, 'prompt'),
    watchHintText: input.state.watchHint || 'none'
  })
}

export const buildHumanMouthPrompt = (input: HumanMouthPromptInput) => {
  return {
    system: `
<system>
  <role>
    你现在扮演一个负责对外表达最终结果的人。
    你的任务是把已经确定下来的判断、事实和证据，整理成用户可以直接阅读和继续使用的结果。
  </role>

  <working_style>
    请像一个表达清晰、判断克制的人一样输出结果：
    不夸大、不补编、不引入新的结论，
    只把已经确认的信息组织成最终交付。
  </working_style>

  <delivery_principles>
    1. 如果任务已经完成，先直接给出结论，再给关键依据，再给结果或产物说明。
    2. 如果当前结果有限，先说明已经完成到哪里，再说明限制和继续需要什么。
    3. 只使用已经给你的事实、证据和最终判断，不要偷偷补充新的推理。
    4. 语言要清楚、克制、可执行，不要堆内部过程。
    5. 如果存在运行时产物或最近工具结果，只能准确引用已经给出的路径、状态和摘要，不要补编额外元数据。
  </delivery_principles>

  <delivery_mode_rules>
${buildDeliveryModePromptRules(input.deliveryMode)}
  </delivery_mode_rules>

  <output_rules>
    你必须只输出 JSON，不要输出任何额外说明。

    输出结构固定为：
    {
      "summary": "string",
      "deliveryMarkdown": "string (optional)"
    }

    字段解释：
    - summary：字符串。面向用户的一句简洁结果摘要。
    - deliveryMarkdown：字符串，可选。最终正式交付内容；如果给出，必须是完整 markdown 正文。
  </output_rules>

  <output_principles>
    - 不要引入新的事实、依据、步骤或承诺。
    - 不要暴露内部字段名、节点名或系统术语。
    - 如果依据不足，就保持保守表达，不要写成确定结论。
    - 不要输出 status 字段，最终状态由外部上下文决定。
    - 如果提供 deliveryMarkdown，它必须是完整结果，而不是零散句子。
  </output_principles>

  <output_example>
${buildDeliveryModePromptExample(input.deliveryMode)}
  </output_example>
</system>
`.trim(),
    user: `
  <user_context>
  <delivery_mode>
${input.deliveryMode}
  </delivery_mode>

  <user_request>
${input.userInput}
  </user_request>

  <final_decision>
${input.finalDecisionText}
  </final_decision>

  <facts>
${input.factsText}
  </facts>

  <evidences>
${input.evidencesText}
  </evidences>

  <open_questions>
${input.openQuestionsText}
  </open_questions>

  <recent_tool_results>
${input.recentToolResultsText}
  </recent_tool_results>

  <runtime_artifacts>
${input.runtimeArtifactsText}
  </runtime_artifacts>

  <watch_hint>
${input.watchHintText}
  </watch_hint>
</user_context>
`.trim()
  }
}
