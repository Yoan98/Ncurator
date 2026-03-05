import { JSON_ONLY_PLAN_CONTRACT } from '../shared/contracts'
import { renderEvidenceLines, renderPromptSections } from '../shared/render'

export type PlanPromptInput = {
  userInput: string
  sessionSummaryText: string
  recentTurnsText: string
  contextEvidence: string[]
}

export const buildPlanPrompt = (input: PlanPromptInput) => {
  return {
    system: ['你是 plan_node。', JSON_ONLY_PLAN_CONTRACT, '请把任务拆成可独立执行的单任务。'].join(
      '\n'
    ),
    user: renderPromptSections([
      { label: '用户输入', value: input.userInput },
      { label: '会话摘要', value: input.sessionSummaryText },
      { label: '最近对话', value: input.recentTurnsText },
      {
        label: '上下文证据',
        value: renderEvidenceLines(input.contextEvidence)
      }
    ])
  }
}
