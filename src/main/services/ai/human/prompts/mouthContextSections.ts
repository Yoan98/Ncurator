import type { HumanState } from '../types'
import {
  renderHumanEvidenceLines,
  renderHumanFactLines,
  renderHumanOpenQuestionLines
} from '../shared/memoryRenderers'

export const buildFinalDecisionText = (state: HumanState): string =>
  state.lastBrainDecision
    ? `最终决定：“${state.lastBrainDecision.decision.summary}”；原因：${state.lastBrainDecision.decision.reason}；预期结果：${state.lastBrainDecision.decision.expectedOutcome}`
    : 'none'

export const buildMouthFactsText = (state: HumanState): string =>
  renderHumanFactLines(state, 'mouth_prompt')

export const buildMouthEvidenceText = (state: HumanState): string =>
  renderHumanEvidenceLines(state, 'mouth_prompt')

export const buildMouthOpenQuestionsText = (state: HumanState): string =>
  renderHumanOpenQuestionLines(state, 'mouth_prompt')
