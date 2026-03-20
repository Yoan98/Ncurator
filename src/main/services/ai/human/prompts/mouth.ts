import { renderPromptSections } from '../../promptUtils'
import type { HumanFinalizePromptInput } from './types'

export const buildHumanFinalizePrompt = (input: HumanFinalizePromptInput) => {
  return {
    system: [
      '你是 human_finalize。',
      '请基于任务目标、最终 outcome、memory 与 trace，生成最终交付 markdown。',
      '如果任务完成，正文要直接给出结论与关键依据。',
      '如果任务 blocked，要明确说明当前完成度、阻塞原因和建议下一步。',
      '只输出 markdown，不要输出 JSON。'
    ].join('\n'),
    user: renderPromptSections([
      { label: '任务目标', value: input.objective },
      { label: '终态', value: input.outcomeStatus },
      { label: '终态摘要', value: input.outcomeSummary },
      { label: '结构化结果', value: input.payloadText },
      { label: '当前 memory', value: input.memoryText },
      { label: '最近 trace', value: input.traceText }
    ])
  }
}
