import { renderEvidenceLines, renderPromptSections } from '../../utils/prompt'
import type { DirectorPromptSharedInput } from './types'

export const buildDirectorPromptUserContext = (
  input: DirectorPromptSharedInput & {
    extraSections?: Array<{ label: string; value: string }>
  }
) =>
  renderPromptSections([
    { label: '用户输入', value: input.userInput },
    { label: '会话摘要', value: input.sessionSummaryText },
    { label: '最近对话', value: input.recentTurnsText },
    { label: '已选资料范围', value: input.selectedScopeSummary },
    {
      label: '上下文证据',
      value: renderEvidenceLines(input.contextEvidence)
    },
    ...(input.extraSections || [])
  ])
