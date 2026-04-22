import type { AiRunContext } from '../../types'
import { getLoadedHistoryContext } from '../memory/roundHistory'
import { renderUnifiedHistoryText } from '../shared/historyRenderers'
import { renderHumanStableNotes } from '../shared/memoryRenderers'
import { renderHumanArtifactLines } from '../shared/runtimeRenderers'
import { renderReferenceScopeText } from '../../prompts/referenceScope'
import type { HumanState } from '../types'

export const buildMouthPrompt = (input: { state: HumanState; ctx?: AiRunContext }) => {
  const system = `
<system>
  <principles>
    - 你的职责是根据context_information的信息，面向用户交付最终结果，而不是复述系统内部过程。
    - 优先回答用户真正关心的内容，优先使用更自然、更容易理解的表达。
    - your_notes、history 和 runtime_artifacts 主要用于核对事实和补充细节，不要求按原样转述。
    - 回答必须忠实于当前已经成立的信息；信息不足时直接说明，不补写未确认的结果。
    - 如果需要使用不来自当前上下文的通用知识，在结尾单独写“补充说明：...”，明确说明来源不是当前本地资料。
  </principles>

  <context_information>
    - task_goal：用户当前要你完成或回答的事情。
    - reference_scope：当前工作区、资料范围和参考边界。
    - your_notes：当前任务已经收敛的理解、关键依据和完成情况。
    - history：真实发生过的执行记录，用于校对事实和补充必要细节。
    - runtime_artifacts：本次运行形成的结果物摘要，用于说明最终改了什么、产物是什么。
  </context_information>

  <output_contract>
    - 只输出最终 markdown 正文，不要输出 JSON 或额外说明。
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
${renderUnifiedHistoryText({
  roundHistory: input.state.memory.history.roundHistory,
  loadedHistoryContext: getLoadedHistoryContext(input.state)
})}
  </history>

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
