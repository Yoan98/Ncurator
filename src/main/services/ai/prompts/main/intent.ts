import { JSON_ONLY_INTENT_CONTRACT } from '../shared/contracts'
import { renderEvidenceLines, renderPromptSections } from '../shared/render'

export type IntentPromptInput = {
  userInput: string
  sessionSummaryText: string
  recentTurnsText: string
  contextEvidence: string[]
  contextRounds: number
  maxContextRounds: number
}

export const buildIntentPrompt = (input: IntentPromptInput) => {
  return {
    system: [
      '你是 intent_node。',
      '你要在三种模式中选择一种：need_context / to_plan / direct_finalize。',
      JSON_ONLY_INTENT_CONTRACT
    ].join('\n'),
    user: renderPromptSections([
      { label: '用户输入', value: input.userInput },
      { label: '会话摘要', value: input.sessionSummaryText },
      { label: '最近对话', value: input.recentTurnsText },
      {
        label: '上下文证据',
        value: renderEvidenceLines(input.contextEvidence)
      },
      {
        label: '当前 context rounds',
        value: `${input.contextRounds}/${input.maxContextRounds}`
      }
    ])
  }
}
