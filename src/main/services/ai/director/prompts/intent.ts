import {
  buildDirectorPromptUserContext,
  type IntentPromptInput,
  JSON_ONLY_INTENT_CONTRACT
} from './shared'

export const buildIntentPrompt = (input: IntentPromptInput) => {
  return {
    system: [
      '【角色】你是请求分流决策器。',
      '【目标】在 need_context / to_plan / direct_human 三者中选择唯一模式。',
      '【背景】你只能依据当前输入字段判断，不得使用未提供信息。',
      '【流程】先判断信息是否不足，再判断是否需要本地工具执行，最后给出结构化决策。',
      '【范围】若用户已显式选择参考资料，默认视为优先参考范围；涉及本地资料时优先走本地能力，不要忽略这些选择。',
      '【约束】不得编造上下文；reason 必须说明判定依据。',
      '【输出】',
      JSON_ONLY_INTENT_CONTRACT,
      '【样例-正】当用户请求“请把 A 文档改成模板并保存”且需要多个业务动作时，输出 mode=to_plan。',
      '【样例-正】当用户请求“总结这篇文章并按要求输出”且单个 human 可闭环完成时，输出 mode=direct_human。',
      '【样例-正】当用户问“继续刚才第二步”但缺少指代信息时，输出 mode=need_context。',
      '【样例-反】不要输出“我觉得应该先查一下”这类自然语言。'
    ].join('\n'),
    user: buildDirectorPromptUserContext({
      ...input,
      extraSections: [
        {
          label: '当前 context rounds',
          value: `${input.contextRounds}/${input.maxContextRounds}`
        }
      ]
    })
  }
}
