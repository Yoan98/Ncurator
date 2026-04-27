import type { AiRunContext } from '../../types'
import { getLoadedHistoryContext } from '../memory/roundHistory'
import { renderDeliveryGuidanceItems } from '../shared/deliveryGuidance'
import { renderMouthHistoryText } from '../shared/historyRenderers'
import { renderHumanStableNotes } from '../shared/memoryRenderers'
import { renderHumanArtifactLines } from '../shared/runtimeRenderers'
import { renderReferenceScopeText } from '../../prompts/referenceScope'
import type { HumanState } from '../types'

export const buildMouthPrompt = (input: { state: HumanState; ctx?: AiRunContext }) => {
  const system = `
<system>
  <principles>
    - 你的职责是根据context_information的信息，面向用户交付最终结果，而不是复述系统内部过程。
    - 必须严格按照context_information的信息处理回答，不得编造不存在其中的信息。
    - 优先回答用户真正关心的内容，优先使用更自然、更容易理解的表达。
    - your_notes、history、delivery_guidance 和 runtime_artifacts 主要用于核对事实和补充细节，不要求按原样转述。
  </principles>

  <context_information>
    - task_goal：用户当前要你完成或回答的事情。
    - reference_scope：当前工作区、资料范围和参考边界。
    - your_notes：当前任务已经收敛的理解、关键依据和完成情况。
    - history：对最终答复有价值的已发生事实、关键结果和失败情况。
    - delivery_guidance：本次最终交付必须明确吸收的额外说明；没有时为 none。
    - runtime_artifacts：本次运行形成的结果物摘要，用于说明最终改了什么、产物是什么。
  </context_information>

  <output_contract>
    - 只输出最终 markdown 正文，不要输出 JSON 或额外说明。
    - 禁止向用户暴露系统内部定位信息、实现细节或运行态标识，例如块编号、段落锚点、内部字段名、工具名；
  </output_contract>
</system>
`.trim()

  const user = `
<user_context>
  <task_goal>
${input.state.task.userInput}
  </task_goal>

  <reference_scope>
${renderReferenceScopeText(
  input.ctx?.referenceScope || {
    selectedReferences: [],
    hasExplicitSelectedReferences: false,
    hasDirectDocumentNarrowing: false,
    defaultKnowledgeScope: 'unavailable'
  }
)}
  </reference_scope>

  <your_notes>
${renderHumanStableNotes(input.state, 'mouth_prompt')}
  </your_notes>

  <history>
${renderMouthHistoryText({
  roundHistory: input.state.memory.history.roundHistory,
  loadedHistoryContext: getLoadedHistoryContext(input.state)
})}
  </history>

  <delivery_guidance>
${renderDeliveryGuidanceItems(input.state.execution.deliveryGuidanceItems)}
  </delivery_guidance>

  <runtime_artifacts>
${renderHumanArtifactLines(input.state, 'prompt')}
  </runtime_artifacts>
</user_context>
`.trim()

  return {
    system,
    user
  }
}
