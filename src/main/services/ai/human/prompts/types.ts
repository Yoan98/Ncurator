import type { HumanDeliveryMode } from '../types'

export type HumanBrainPromptInput = {
  userInput: string
  memorySnapshotText: string
  skillContextText: string
  recentToolResultsText: string
  recentDecisionHistoryText: string
  watchHintText: string
}

export type HumanMouthPromptInput = {
  deliveryMode: HumanDeliveryMode
  userInput: string
  finalStatus: 'completed' | 'blocked'
  finalDecisionText: string
  factsText: string
  evidencesText: string
  openQuestionsText: string
}
