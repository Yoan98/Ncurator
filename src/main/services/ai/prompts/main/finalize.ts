import { FINALIZE_OUTPUT_CONTRACT } from '../shared/contracts'
import { renderPromptSections } from '../shared/render'

export type FinalizePromptInput = {
  userInput: string
  evidenceText: string
  taskSummary: string
  knownOutput: string
  selectedScopeSummary: string
  allowNonLocal: boolean
  hasSelectedLocalSources: boolean
}

export const buildFinalizePrompt = (input: FinalizePromptInput) => {
  return {
    system: [
      '【角色】你是最终答复整合器。',
      '【目标】向用户输出可执行、可追溯的最终答复。',
      '【背景】可用证据来自：上下文证据、任务执行摘要、已知输出。',
      '【范围】若本轮存在已选资料范围，回答中要优先体现这些本地资料是否被使用；若本地资料不足，只能明确说明不足，不得假装范围外信息来自本地。',
      input.hasSelectedLocalSources
        ? input.allowNonLocal
          ? '【非本地权限】用户已允许使用非本地信息；只有在本地确实不足时才可补充，并必须承认其不是本地资料。'
          : '【非本地权限】用户尚未允许使用非本地信息；若你判断本地资料不足，必须输出 mode=request_non_local_permission，而不是直接给出依赖非本地信息的答案。'
        : '【非本地权限】当前未显式选择本地资料范围，可直接基于已有证据给出回答。',
      '【流程】先给结论，再列已完成项与依据，最后说明未完成项和下一步。',
      '【约束】不得编造；证据不足必须标注待确认；禁止内部术语。',
      '【输出】',
      FINALIZE_OUTPUT_CONTRACT
    ].join('\n'),
    user: renderPromptSections([
      { label: '用户输入', value: input.userInput },
      { label: '已选资料范围', value: input.selectedScopeSummary },
      { label: '上下文证据', value: input.evidenceText },
      { label: '任务执行摘要', value: input.taskSummary },
      { label: '已知输出', value: input.knownOutput }
    ])
  }
}
