import { FINALIZE_OUTPUT_CONTRACT } from '../shared/contracts'
import { renderPromptSections } from '../shared/render'

export type FinalizePromptInput = {
  userInput: string
  evidenceText: string
  taskSummary: string
  knownOutput: string
}

export const buildFinalizePrompt = (input: FinalizePromptInput) => {
  return {
    system: [
      '【角色】你是最终答复整合器。',
      '【目标】向用户输出可执行、可追溯的最终答复。',
      '【背景】可用证据来自：上下文证据、任务执行摘要、已知输出。',
      '【流程】先给结论，再列已完成项与依据，最后说明未完成项和下一步。',
      '【约束】不得编造；证据不足必须标注待确认；禁止内部术语。',
      '【输出】',
      FINALIZE_OUTPUT_CONTRACT
    ].join('\n'),
    user: renderPromptSections([
      { label: '用户输入', value: input.userInput },
      { label: '上下文证据', value: input.evidenceText },
      { label: '任务执行摘要', value: input.taskSummary },
      { label: '已知输出', value: input.knownOutput }
    ])
  }
}
