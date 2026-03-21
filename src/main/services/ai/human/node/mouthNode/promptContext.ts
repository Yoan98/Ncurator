import { buildHumanMouthPrompt } from '../../prompts/mouth'
import type { HumanDeliveryMode, HumanState } from '../../types'

const renderFacts = (state: HumanState): string => {
  if (state.brainMemory.inside.facts.length === 0) return 'none'
  return state.brainMemory.inside.facts
    .map((fact) => `- ${fact.summary} (evidenceIds=[${fact.evidenceIds.join(', ')}])`)
    .join('\n')
}

const renderEvidences = (state: HumanState): string => {
  if (state.brainMemory.inside.evidences.length === 0) return 'none'
  return state.brainMemory.inside.evidences
    .map((evidence) => `- ${evidence.toolName}: ${evidence.summary}${evidence.rawRef ? ` (${evidence.rawRef})` : ''}`)
    .join('\n')
}

const renderOpenQuestions = (state: HumanState): string => {
  if (state.brainMemory.inside.openQuestions.length === 0) return 'none'
  return state.brainMemory.inside.openQuestions.map((question) => `- ${question}`).join('\n')
}

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
    factsText: renderFacts(input.state),
    evidencesText: renderEvidences(input.state),
    openQuestionsText: renderOpenQuestions(input.state)
  })
}
