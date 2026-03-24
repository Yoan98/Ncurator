export type DirectorPromptSharedInput = {
  userInput: string
  sessionSummaryText: string
  recentTurnsText: string
  contextEvidence: string[]
  selectedScopeSummary: string
}

export type IntentPromptInput = DirectorPromptSharedInput & {
  contextRounds: number
  maxContextRounds: number
}

export type PlanPromptInput = DirectorPromptSharedInput
