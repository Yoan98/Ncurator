import {
  HUMAN_FINAL_DELIVERY_MARKDOWN_CONTRACT,
  HUMAN_HANDOFF_MARKDOWN_CONTRACT
} from '../shared/contracts'
import { renderPromptSections } from '../shared/render'
import type { HumanDeliveryKind } from '../../types'

export type HumanResponsePromptInput = {
  objective: string
  deliveryKind: HumanDeliveryKind
  selectedScopeSummary: string
  allowNonLocal: boolean
  summary: string
  resultCode: string
  resultDataText: string
  lastObservationText: string
  stepHistoryText: string
}

const buildSystemInstructions = (input: HumanResponsePromptInput) => {
  if (input.deliveryKind === 'final') {
    return [
      '【角色】你是任务交付生成器。',
      '【目标】基于当前任务 objective、执行摘要、step history 与 observation 生成最终用户可见答复。',
      '【范围】若本轮存在已选资料范围，回答中要优先体现这些本地资料是否被使用；若本地资料不足，不得假装范围外信息来自本地。',
      input.allowNonLocal
        ? '【非本地权限】用户已允许使用非本地信息；只有在本地确实不足时才可补充，并必须承认其不是本地资料。'
        : '【非本地权限】用户尚未允许使用非本地信息；若你判断本地资料不足，必须明确说明本地不足并询问是否允许继续使用非本地信息。',
      '【流程】先写结论，再写已完成内容与关键依据，最后说明未完成项和下一步建议。',
      '【输出协议】',
      HUMAN_FINAL_DELIVERY_MARKDOWN_CONTRACT
    ].join('\n')
  }

  return [
    '【角色】你是任务交接文档生成器。',
    '【目标】基于当前任务 objective、执行摘要、step history 与 observation 生成供后续 human 继续执行的正式交付。',
    '【流程】先说明已完成内容，再写关键发现与证据，最后明确未决风险和建议后续步骤。',
    '【约束】必须让下一个 human 在不读取内部运行态的情况下也能继续工作。',
    '【输出协议】',
    HUMAN_HANDOFF_MARKDOWN_CONTRACT
  ].join('\n')
}

export const buildHumanResponsePrompt = (input: HumanResponsePromptInput) => {
  return {
    system: buildSystemInstructions(input),
    user: renderPromptSections([
      { label: '任务 objective', value: input.objective },
      { label: '已选资料范围', value: input.selectedScopeSummary },
      { label: '任务摘要', value: input.summary },
      { label: '结果码', value: input.resultCode },
      { label: 'Result Data', value: input.resultDataText },
      { label: 'Last Observation', value: input.lastObservationText },
      { label: 'Recent Steps', value: input.stepHistoryText }
    ])
  }
}
