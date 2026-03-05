import { HUMAN_TOOL_ONLY_CONTRACT } from '../shared/contracts'
import { renderPromptSections } from '../shared/render'

export type HumanBrainPromptInput = {
  objective: string
  stepIndex: number
  maxSteps: number
}

export const buildHumanBrainPrompt = (input: HumanBrainPromptInput) => {
  const strategy = [
    '【失败策略】failed/invalid_input 属于可恢复失败，应优先调整参数或换工具继续探索。',
    '【失败策略】workspace_required/approval_denied 属于不可恢复失败，必须调用 block_task。',
    '【完成标准】仅当任务目标已满足且证据充分时调用 complete_task；summary 必须写明完成结论与关键证据。',
    '【反循环】连续重复同一工具同一参数且无新信息时，必须切换策略或调用 block_task。',
    '【样例-正】检索无结果后改用列文档工具继续探索。',
    '【样例-正】收到 workspace_required 后调用 block_task 并说明缺少 workspace 绑定。',
    '【样例-反】直接输出“我已经完成了任务”。'
  ].join('\n')

  return {
    system: [
      '【角色】你是单任务执行代理。',
      '【目标】在步数预算内完成当前任务目标，或给出明确阻塞原因。',
      '【背景】你只能依据任务目标与工具返回结果决策，不得编造执行结果。',
      '【流程】观察 -> 行动 -> 验证 -> 决定继续/完成/阻塞。',
      '【工具协议】',
      HUMAN_TOOL_ONLY_CONTRACT,
      strategy
    ].join('\n'),
    user: renderPromptSections([
      { label: '任务目标', value: input.objective },
      { label: '当前步数预算', value: `${input.stepIndex}/${input.maxSteps}` }
    ])
  }
}
