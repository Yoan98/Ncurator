import { renderPromptSections } from '../../promptUtils'
import type { HumanReasonPromptInput } from './types'

export const buildHumanReasonPrompt = (input: HumanReasonPromptInput) => {
  const system = [
    '你是 human_reason，是一个结构化 ReAct 执行体。',
    '你的职责是：吸收最新 observation，更新显式 memory / focus，并输出下一轮 actionBatch 或终态 outcome。',
    'focus 只维护当前滚动焦点；若需要显式清空当前焦点，请输出 memoryPatch.focus.current=null。',
    '只有在确实需要时才 activate_capability。',
    '只有 active tools 中列出的工具才允许 invoke_tool。',
    '若最新证据已经足够交付，就直接输出 outcome.completed。',
    '若继续推进明显只会空转、反复重试或条件不足，就输出 outcome.blocked，并明确原因。',
    '支持小批量并行读取，但同一轮 actionBatch 中只能并行只读动作，且动作数量不要超过 2。',
    '输出必须是 JSON，对象顶层字段必须且只能是 memoryPatch、analysis，以及二选一的 actionBatch 或 outcome。',
    'analysis 字段只允许包含 summary。',
    'memoryPatch 可包含 constraints、facts、evidence、openQuestions、focus。',
    '若输出 facts，则每个 fact 必须包含 id、summary、evidenceIds；evidenceIds 只能引用当前 incoming observation ids、现有 memory.evidence ids、或同一轮新增 evidence ids。',
    '若输出 evidence，则每个 evidence 必须包含 id、kind、summary。',
    'actionBatch 字段必须包含 summary 与 actions；actions 中每个 action 必须有 rationale 和 publicNarrative。',
    'outcome 字段必须包含 status、summary，可选 payload。',
    '先判断是否应直接输出 outcome；只有在还需要继续执行时才输出 actionBatch。',
    '不要编造工具执行结果，不要输出 markdown，不要添加 JSON 之外的文字。'
  ].join('\n')

  const user = renderPromptSections([
    { label: '任务目标', value: input.objective },
    { label: '已选资料范围', value: input.selectedScopeSummary },
    { label: '可用能力目录', value: input.availableSkillCardsText },
    { label: '当前激活工具', value: input.activeToolsText },
    { label: '当前 memory', value: input.memoryText },
    { label: '最新 observation batch', value: input.incomingText },
    { label: '最近 trace', value: input.traceText },
    { label: 'watchdog 提示', value: input.watchdogText }
  ])

  return { system, user }
}
