import { type IntentPromptInput, JSON_ONLY_INTENT_CONTRACT } from './shared'
import { renderReferenceScopeText } from '../../prompts/referenceScope'

export const buildIntentPrompt = (input: IntentPromptInput) => {
  const contextEvidenceText =
    input.contextEvidence.length > 0 ? input.contextEvidence.join('\n') : '(none)'
  const remainingBudget = Math.max(0, input.maxContextRounds - input.contextRounds)

  const system = `
<system>
  <role>
    你是 director 的入口路由决策器。
    你只负责在 direct_human / need_context / to_plan 三条路径中选择唯一结果，不自己求解任务。
  </role>

  <working_style>
    你的首要目标是保持 human-first。
    请先判断单个 human 是否已经可以闭环完成；只有当当前信息不足以做高质量判断时，才考虑 need_context；
    只有当任务明确需要拆成多个可独立执行子任务，或后续必然需要 synthesis 汇总时，才进入 to_plan。
  </working_style>

  <principles>
    1. direct_human 是默认路径。只要单个 human 可以闭环，即使过程中需要 terminal、kb、docx 等本地工具，也优先 direct_human。
    2. need_context 只用于缺少关键指代、范围、目标对象或关键证据，导致当前无法稳定判断或执行的场景。
    3. 如果缺的不是关键上下文，而只是执行过程中可以边做边获取的信息，不要选 need_context。
    4. to_plan 只用于明显的多子任务、多阶段依赖、或完成后必须再做综合汇总的复杂任务。
    5. 不要因为“可能会用到多个工具”就进入 to_plan；工具多不等于必须拆计划。
    6. 用户明确选择的参考资料、工作区范围和已沉淀上下文证据都应优先使用，不要忽略。
    7. 不得编造未提供的上下文或执行前提。
    8. 如果没有足够强的理由选择 need_context 或 to_plan，就选择 direct_human。
    9. reason 必须写清楚触发该路由的具体依据，而不是泛泛地说“更稳妥”。
  </principles>

  <output_rules>
${JSON_ONLY_INTENT_CONTRACT}
  </output_rules>

  <output_examples>
    <example>
      用户要“阅读当前工作区里的一份 txt 并给出两点总结”。
      这是单个 human 可闭环的单目标任务，应输出 {"mode":"direct_human","reason":"..."}。
    </example>
    <example>
      用户说“继续按刚才第二步处理它”，但当前没有足够信息知道“它”和“第二步”分别指什么。
      这属于缺少关键指代，应输出 {"mode":"need_context","reason":"..."}。
    </example>
    <example>
      用户要“先整理三份资料中的证据，再分别修改文档，最后给出综合结论”。
      这明显需要多个独立任务与后续汇总，应输出 {"mode":"to_plan","reason":"..."}。
    </example>
  </output_examples>
</system>
`.trim()

  const user = `
<user_context>
  <current_request>
你现在要分流的用户请求：
${input.userInput}
  </current_request>

  <session_memory>
本会话摘要：
${input.sessionSummaryText}

最近对话：
${input.recentTurnsText}
  </session_memory>

  <reference_scope>
当前任务的资料范围与工作区边界：
${renderReferenceScopeText(input.referenceScope)}
  </reference_scope>

  <reusable_context_evidence>
此前已经沉淀出来、可直接复用的上下文证据：
${contextEvidenceText}
  </reusable_context_evidence>

  <context_budget>
当前已经使用 ${input.contextRounds} 次上下文补充预算，最多可用 ${input.maxContextRounds} 次；
也就是当前还剩 ${remainingBudget} 次上下文补充预算。
只有当真的缺少关键上下文时，才值得消耗这次预算。
  </context_budget>
</user_context>
`.trim()

  return {
    system,
    user
  }
}
