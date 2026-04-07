import type { HumanDeliveryMode, HumanState } from '../types'
import {
  buildDeliveryModePromptExample,
  buildDeliveryModePromptRules
} from '../shared/deliveryContracts'
import { buildLastRoundFocusText } from '../memory/historyPrompt'
import {
  renderHumanEvidenceLines,
  renderHumanFactLines,
  renderHumanOpenQuestionLines
} from '../shared/memoryRenderers'
import { renderHumanArtifactLines } from '../shared/runtimeRenderers'
import { renderWatchHintForMouth } from './watchHints'

type HumanMouthPromptInput = {
  deliveryMode: HumanDeliveryMode
  userInput: string
  finalDecisionText: string
  factsText: string
  evidencesText: string
  openQuestionsText: string
  lastRoundFocusText: string
  runtimeArtifactsText: string
  watchHintText: string
}

const buildFinalDecisionText = (state: HumanState): string =>
  state.lastBrainDecision
    ? `最终决定（readyToDeliver=${String(state.lastBrainDecision.readyToDeliver)}）：“${state.lastBrainDecision.decision.summary}”；原因：${state.lastBrainDecision.decision.reason}；预期结果：${state.lastBrainDecision.decision.expectedOutcome}`
    : 'none'

export const buildMouthSystemPrompt = (deliveryMode: HumanDeliveryMode): string =>
  `
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
    6. 你不会调用工具，也不会继续推进未完成步骤；如果仍有步骤没做，只能如实说明当前停在哪。
  </delivery_principles>

  <delivery_mode_rules>
${buildDeliveryModePromptRules(deliveryMode)}
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
${buildDeliveryModePromptExample(deliveryMode)}
  </output_example>
</system>
`.trim()

export const buildMouthUserPrompt = (input: HumanMouthPromptInput): string =>
  `
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

  <last_round_focus>
${input.lastRoundFocusText}
  </last_round_focus>

  <runtime_artifacts>
${input.runtimeArtifactsText}
  </runtime_artifacts>

  <watch_hint>
${input.watchHintText}
  </watch_hint>
</user_context>
`.trim()

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
    lastRoundFocusText: buildLastRoundFocusText(input.state),
    runtimeArtifactsText: renderHumanArtifactLines(input.state, 'prompt'),
    watchHintText: input.state.watchHint ? renderWatchHintForMouth(input.state.watchHint) : 'none'
  })
}

export const buildHumanMouthPrompt = (input: HumanMouthPromptInput) => {
  return {
    system: buildMouthSystemPrompt(input.deliveryMode),
    user: buildMouthUserPrompt(input)
  }
}
