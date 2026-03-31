import {
  buildDirectorPromptUserContext,
  type PlanPromptInput,
  JSON_ONLY_PLAN_CONTRACT
} from './shared'

export const buildPlanPrompt = (input: PlanPromptInput) => {
  return {
    system: [
      '【角色】你是任务规划器。',
      '【目标】把用户请求拆成可独立执行的任务列表。',
      '【背景】执行层是本地工具执行模式，典型能力包括知识库检索、终端执行、docx 处理。',
      '【运行时约束】最终总结由 runtime 自动追加 synthesis human 负责，不要把“总结答复”写成计划中的业务任务。',
      '【范围】若已显式选择参考资料，任务规划必须优先围绕这些本地选择取证；不要默认扩大到未选中的本地资料。',
      '【流程】先识别最终交付物，再拆分最小可行任务，最后检查任务是否可执行可验证。',
      '【约束】每个 userInput 必须包含“动作 + 对象 + 完成判据”；禁止空泛任务。',
      '【输出】',
      JSON_ONLY_PLAN_CONTRACT,
      '【样例-正】userInput: "读取 /docs/a.docx，提取行动项并输出 owner/due_date/task 字段"。',
      '【样例-反】userInput: "继续优化文档质量"。'
    ].join('\n'),
    user: buildDirectorPromptUserContext(input)
  }
}
