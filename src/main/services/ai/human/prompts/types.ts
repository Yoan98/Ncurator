export type HumanReasonPromptInput = {
  objective: string
  selectedScopeSummary: string
  availableSkillCardsText: string
  activeToolsText: string
  memoryText: string
  incomingText: string
  traceText: string
  watchdogText: string
}

export type HumanFinalizePromptInput = {
  objective: string
  outcomeSummary: string
  outcomeStatus: 'completed' | 'blocked'
  payloadText: string
  memoryText: string
  traceText: string
}
