import { buildHumanBrainPrompt } from '../../prompts/brain'
import type { HumanState } from '../../types'
import {
  buildMemorySnapshotText,
  buildRecentDecisionHistoryText,
  buildRecentToolResultsText,
  buildSkillContextText
} from '../../prompts/brainContextSections'

export const buildBrainPromptContext = (state: HumanState) =>
  buildHumanBrainPrompt({
    userInput: state.task.userInput,
    memorySnapshotText: buildMemorySnapshotText(state),
    skillContextText: buildSkillContextText(state),
    recentToolResultsText: buildRecentToolResultsText(state),
    recentDecisionHistoryText: buildRecentDecisionHistoryText(state),
    watchHintText: [
      '如果这里是 none，表示当前没有额外的收敛提醒；否则应优先考虑结束任务或纠偏。',
      '',
      state.watchHint || 'none'
    ].join('\n')
  })
