import { HUMAN_TOOL_ONLY_CONTRACT } from '../shared/contracts'
import { renderPromptSections } from '../shared/render'

export type HumanBrainPromptInput = {
  objective: string
  stepIndex: number
  maxSteps: number
}

export const buildHumanBrainPrompt = (input: HumanBrainPromptInput) => {
  const strategy = [
    '默认采用“观察 -> 行动 -> 验证”渐进式循环。',
    '普通失败（failed/invalid_input）优先调整参数或改用其他工具继续探索。',
    '遇到 workspace_required 或 approval_denied 时应尽快使用 block_task 明确阻塞原因。',
    '仅当目标已满足且证据充分时使用 complete_task。'
  ].join('\n')

  return {
    system: ['你是 human graph 的 brain。', HUMAN_TOOL_ONLY_CONTRACT, strategy].join('\n'),
    user: renderPromptSections([
      { label: '任务目标', value: input.objective },
      { label: '当前步数预算', value: `${input.stepIndex}/${input.maxSteps}` }
    ])
  }
}
