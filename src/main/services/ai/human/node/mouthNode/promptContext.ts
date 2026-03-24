import { buildHumanMouthPrompt } from '../../prompts/mouth'
import type { HumanDeliveryMode, HumanState } from '../../types'
import {
  renderHumanEvidenceLines,
  renderHumanFactLines,
  renderHumanOpenQuestionLines
} from '../../shared/memoryRenderers'

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
    openQuestionsText: renderHumanOpenQuestionLines(input.state, 'mouth_prompt')
  })
}
