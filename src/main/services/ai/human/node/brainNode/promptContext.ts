import { buildHumanBrainPrompt } from '../../prompts/brain'
import type { HumanState } from '../../types'
import {
  buildBrainPromptSections
} from '../../prompts/brainContextSections'

export const buildBrainPromptContext = (state: HumanState) => {
  const sections = buildBrainPromptSections(state)

  return buildHumanBrainPrompt({
    userInput: state.task.userInput,
    memorySnapshotText: sections.memorySnapshotText,
    skillContextText: sections.skillContextText,
    recentToolResultsText: sections.recentToolResultsText,
    recentDecisionHistoryText: sections.recentDecisionHistoryText,
    watchHintText: [
      '如果这里是 none，表示当前没有额外的收敛提醒；否则应优先考虑结束任务或纠偏。',
      '',
      state.watchHint || 'none'
    ].join('\n')
  })
}
