import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { HumanRunState } from './types'

export const createHumanInitNode = () => {
  return async (state: HumanRunState): Promise<Partial<HumanRunState>> => {
    const baseMessages = [
      new SystemMessage(
        [
          '你是 human graph 的 brain。',
          '你每一步必须使用 tool call。',
          '可用工具包含 capability tools 与控制工具 complete_task/block_task。',
          '当调用 capability tool 时，必须显式传递 consume/produce/expect。',
          '禁止直接输出自然语言结论，不允许无工具步骤。'
        ].join('\n')
      ),
      new HumanMessage(
        [
          `任务模式: ${state.input.mode}`,
          `任务标题: ${state.input.title}`,
          `任务目标: ${state.input.objective}`,
          `任务类型提示: ${state.input.kindHint || 'none'}`,
          `当前 slots: ${JSON.stringify(state.slotState)}`
        ].join('\n')
      )
    ]

    return {
      phase: 'brain',
      terminalState: 'running',
      messages: baseMessages,
      steps: 0,
      summary: '',
      resultCode: 'failed',
      resultData: undefined,
      slotDelta: {}
    }
  }
}
