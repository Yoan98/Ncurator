import { buildHumanMouthPrompt } from '../../prompts/mouth'
import type { HumanDeliveryMode, HumanState } from '../../types'
import {
  buildFinalDecisionText,
  buildMouthEvidenceText,
  buildMouthFactsText,
  buildMouthOpenQuestionsText
} from '../../prompts/mouthContextSections'

export const buildMouthPromptContext = (input: {
  state: HumanState
  deliveryMode: HumanDeliveryMode
}) => {
  return buildHumanMouthPrompt({
    deliveryMode: input.deliveryMode,
    userInput: input.state.task.userInput,
    finalDecisionText: buildFinalDecisionText(input.state),
    factsText: buildMouthFactsText(input.state),
    evidencesText: buildMouthEvidenceText(input.state),
    openQuestionsText: buildMouthOpenQuestionsText(input.state)
  })
}
