import type { HumanMouthPromptInput } from './types'
import {
  buildStructuredDeliveryPromptExample,
  buildStructuredDeliveryPromptRules
} from '../shared/deliveryContracts'

const buildDeliveryModeRules = (deliveryMode: HumanMouthPromptInput['deliveryMode']): string => {
  if (deliveryMode === 'task_handoff') {
    return buildStructuredDeliveryPromptRules('task_handoff')
  }

  if (deliveryMode === 'context_note') {
    return buildStructuredDeliveryPromptRules('context_note')
  }

  return [
    '当前 deliveryMode=user_answer。',
    'deliveryMarkdown 面向最终用户，可自然组织为完整 markdown 结果，不要求固定章节。'
  ].join('\n')
}

const buildOutputExample = (deliveryMode: HumanMouthPromptInput['deliveryMode']): string => {
  if (deliveryMode === 'task_handoff') {
    return buildStructuredDeliveryPromptExample('task_handoff')
  }

  if (deliveryMode === 'context_note') {
    return buildStructuredDeliveryPromptExample('context_note')
  }

  return `{
  "summary": "已整理出当前任务的最终答复。",
  "deliveryMarkdown": "# 处理结果\\n\\n已完成本次任务。\\n\\n## 关键依据\\n- 依据一\\n- 依据二"
}`
}

export const buildHumanMouthPrompt = (input: HumanMouthPromptInput) => {
  return {
    system: `
<system>
  <role>
    你现在扮演一个负责对外表达最终结果的人。
    你的任务是把已经确定下来的判断、事实和证据，整理成用户可以直接阅读和继续使用的结果。
  </role>

  <working_style>
    请像一个表达清晰、判断克制的人一样输出结果：
    不夸大、不补编、不引入新的结论，
    只把已经确认的信息组织成最终交付。
  </working_style>

  <delivery_principles>
    1. 如果任务已经完成，先直接给出结论，再给关键依据，再给结果或产物说明。
    2. 如果当前结果有限，先说明已经完成到哪里，再说明限制和继续需要什么。
    3. 只使用已经给你的事实、证据和最终判断，不要偷偷补充新的推理。
    4. 语言要清楚、克制、可执行，不要堆内部过程。
  </delivery_principles>

  <delivery_mode_rules>
${buildDeliveryModeRules(input.deliveryMode)}
  </delivery_mode_rules>

  <output_rules>
    你必须只输出 JSON，不要输出任何额外说明。

    输出结构固定为：
    {
      "summary": "string",
      "deliveryMarkdown": "string (optional)"
    }

    字段解释：
    - summary：字符串。面向用户的一句简洁结果摘要。
    - deliveryMarkdown：字符串，可选。最终正式交付内容；如果给出，必须是完整 markdown 正文。
  </output_rules>

  <output_principles>
    - 不要引入新的事实、依据、步骤或承诺。
    - 不要暴露内部字段名、节点名或系统术语。
    - 如果依据不足，就保持保守表达，不要写成确定结论。
    - 不要输出 status 字段，最终状态由外部上下文决定。
    - 如果提供 deliveryMarkdown，它必须是完整结果，而不是零散句子。
  </output_principles>

  <output_example>
${buildOutputExample(input.deliveryMode)}
  </output_example>
</system>
`.trim(),
    user: `
  <user_context>
  <delivery_mode>
${input.deliveryMode}
  </delivery_mode>

  <user_request>
${input.userInput}
  </user_request>

  <final_decision>
${input.finalDecisionText}
  </final_decision>

  <facts>
${input.factsText}
  </facts>

  <evidences>
${input.evidencesText}
  </evidences>

  <open_questions>
${input.openQuestionsText}
  </open_questions>
</user_context>
`.trim()
  }
}
