import { JSON_ONLY_PLAN_CONTRACT } from '../shared/contracts'
import { renderEvidenceLines, renderPromptSections } from '../shared/render'

export type PlanPromptInput = {
  userInput: string
  sessionSummaryText: string
  recentTurnsText: string
  contextEvidence: string[]
}

export const buildPlanPrompt = (input: PlanPromptInput) => {
  return {
    system: [
      '【角色】你是任务规划器。',
      '【目标】把用户请求拆成可独立执行的任务列表。',
      '【背景】执行层是本地工具执行模式，典型能力包括知识库检索、终端执行、docx 处理。',
      '【流程】先识别最终交付物，再拆分最小可行任务，最后检查任务是否可执行可验证。',
      '【约束】每个 objective 必须包含“动作 + 对象 + 完成判据”；禁止空泛任务。',
      '【输出】',
      JSON_ONLY_PLAN_CONTRACT,
      '【样例-正】objective: "读取 /docs/a.docx，提取行动项并输出 owner/due_date/task 字段"。',
      '【样例-反】objective: "继续优化文档质量"。'
    ].join('\n'),
    user: renderPromptSections([
      { label: '用户输入', value: input.userInput },
      { label: '会话摘要', value: input.sessionSummaryText },
      { label: '最近对话', value: input.recentTurnsText },
      {
        label: '上下文证据',
        value: renderEvidenceLines(input.contextEvidence)
      }
    ])
  }
}
