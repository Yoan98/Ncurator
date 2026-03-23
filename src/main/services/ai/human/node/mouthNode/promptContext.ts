import { buildHumanMouthPrompt } from '../../prompts/mouth'
import type { HumanDeliveryMode, HumanState } from '../../types'
import {
  renderEvidenceLines,
  renderFactLines,
  renderOpenQuestionLines
} from '../../prompts/contextRenderers'

export const buildMouthPromptContext = (input: {
  state: HumanState
  deliveryMode: HumanDeliveryMode
  finalStatus: 'completed' | 'blocked'
}) => {
  const finalDecision = input.state.lastBrainDecision
    ? `最终决定：“${input.state.lastBrainDecision.decision.summary}”；原因：${input.state.lastBrainDecision.decision.reason}；预期结果：${input.state.lastBrainDecision.decision.expectedOutcome}；结束状态${input.finalStatus}`
    : 'none'

  return buildHumanMouthPrompt({
    deliveryMode: input.deliveryMode,
    userInput: input.state.task.userInput,
    finalStatus: input.finalStatus,
    finalDecisionText: finalDecision,
    factsText: renderFactLines(input.state, 'mouth'),
    evidencesText: renderEvidenceLines(input.state, 'mouth'),
    openQuestionsText: renderOpenQuestionLines(input.state)
  })
}
