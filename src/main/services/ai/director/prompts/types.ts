export type IntentPromptInput = {
  userInput: string
  sessionSummaryText: string
  recentTurnsText: string
  contextEvidence: string[]
  contextRounds: number
  maxContextRounds: number
  selectedScopeSummary: string
}

export type PlanPromptInput = {
  userInput: string
  sessionSummaryText: string
  recentTurnsText: string
  contextEvidence: string[]
  selectedScopeSummary: string
}
