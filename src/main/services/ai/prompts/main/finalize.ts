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
    system: '你是 main graph 的 finalize 节点。请给出最终答复。',
    user: renderPromptSections([
      { label: '用户输入', value: input.userInput },
      { label: '上下文证据', value: input.evidenceText },
      { label: '任务执行摘要', value: input.taskSummary },
      { label: '已知输出', value: input.knownOutput },
      { label: '输出要求', value: FINALIZE_OUTPUT_CONTRACT }
    ])
  }
}
