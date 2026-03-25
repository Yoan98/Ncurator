import { renderLineList, renderNamedSections } from '../../utils/render'

export const JSON_ONLY_INTENT_CONTRACT = [
  '只输出 JSON，不得输出任何额外文字。',
  '格式：{"mode":"need_context|to_plan|direct_human","reason":"string"}。',
  '规则：mode 必填；reason 必填。'
].join('\n')

export const JSON_ONLY_PLAN_CONTRACT = [
  '只输出 JSON，不得输出任何额外文字。',
  '格式：{"tasks":[{"id":"string","title":"string","userInput":"string"}]}。',
  '规则：tasks 至少 1 项；每个 userInput 必须是单一任务目标，且可执行、可验证。'
].join('\n')

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

export const buildDirectorPromptUserContext = (
  input: DirectorPromptSharedInput & {
    extraSections?: Array<{ label: string; value: string }>
  }
) =>
  renderNamedSections(
    [
      { label: '用户输入', value: input.userInput },
      { label: '会话摘要', value: input.sessionSummaryText },
      { label: '最近对话', value: input.recentTurnsText },
      { label: '已选资料范围', value: input.selectedScopeSummary },
      {
        label: '上下文证据',
        value: renderLineList(input.contextEvidence, {
          fallback: '(none)',
          style: 'plain'
        })
      },
      ...(input.extraSections || [])
    ],
    {
      fallback: '(none)',
      style: 'plain'
    }
  )
