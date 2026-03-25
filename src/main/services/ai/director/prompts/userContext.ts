import { renderLineList, renderNamedSections } from '../../utils/render'
import type { DirectorPromptSharedInput } from './types'

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
