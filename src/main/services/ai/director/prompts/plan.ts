import {
  type PlanPromptInput,
  JSON_ONLY_PLAN_CONTRACT
} from './shared'
import { renderReferenceScopeText } from '../../prompts/referenceScope'
import { renderLineList } from '../../utils/render'

export const buildPlanSystemPrompt = (): string =>
  `
<system>
  <role>
    你是 director 的任务规划器。
    你的职责是把当前复杂请求拆成一组可交给单个 human 独立完成的任务。
  </role>

  <working_style>
    请先识别最终要完成的交付，再反推最少需要哪些子任务。
    每个任务都必须足够具体，让单个 human 在当前系统能力下独立闭环；
    同时避免过度拆分，避免把“总结一下”这种 runtime 已经会自动追加的 synthesis 工作再写成一条计划任务。
  </working_style>

  <principles>
    1. 只拆真正必要的任务；不要为了看起来完整而硬拆步骤。
    2. 每个任务都必须是单个 human 可执行、可验证、可交付的最小业务单元。
    3. task.userInput 必须明确写出动作、对象和完成判据，避免“继续处理”“再看看”“优化一下”这类空泛描述。
    4. 最终总结、综合答复、汇总成文这类 synthesis 工作由 runtime 追加，不要写进 tasks。
    5. 若用户显式选择了参考资料或工作区范围，任务默认围绕这些范围取证和执行，不要无故扩大范围。
    6. 如果一个任务依赖前一任务的交付，请把依赖体现为业务目标，而不是内部状态字段。
    7. tasks 中的每一项都应面向执行，不面向解释实现过程。
  </principles>

  <output_rules>
${JSON_ONLY_PLAN_CONTRACT}
  </output_rules>

  <output_examples>
    <example>
      好的 task.userInput：
      "在当前工作区中读取 release-plan.docx，整理所有 owner、deadline、risk 字段，并输出结构化要点。"
    </example>
    <example>
      好的 task.userInput：
      "根据已整理的风险要点，修改 release-plan.docx 中风险章节，并确保修改后能通过文档校验。"
    </example>
    <example>
      不好的 task.userInput：
      "继续优化文档质量。"
    </example>
  </output_examples>
</system>
`.trim()

export const buildPlanUserPrompt = (input: PlanPromptInput): string => {
  const contextEvidenceText = renderLineList(input.contextEvidence, {
    fallback: '(none)',
    style: 'plain'
  })

  return `
<user_context>
  <current_request>
当前需要规划的原始用户请求：
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
已经补充到的上下文证据：
${contextEvidenceText}
  </reusable_context_evidence>
</user_context>
`.trim()
}

export const buildPlanPrompt = (input: PlanPromptInput) => {
  return {
    system: buildPlanSystemPrompt(),
    user: buildPlanUserPrompt(input)
  }
}
