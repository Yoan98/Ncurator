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
    你需要整理上下文信息，对用户的诉求进行回复。
  </principles>

  <context_information>
    - task_goal：用户的诉求。
    - reference_scope：当前工作区、默认资料范围、显式选择的优先参考资料与当前缩圈状态。
    - your_notes：当前持续工作的任务笔记。其中：
      - 当前理解：当前任务的最新长期理解。
      - 关键依据：支撑这些理解或下一步动作的证据、来源与关键结果。
      - 检查清单：当前任务板，帮助你理解哪些事项已完成、未完成、受阻或已废弃。
    - history：任务过程中真实发生过的决策、执行和结果，可用于补足 your_notes 不够具体的地方。
    - runtime_artifacts：当前这次运行已经形成的文件改动结果摘要，可用于判断实际改动了哪些文件。
  </context_information>

  <output_contract>
    - 只输出最终 markdown 正文，不要输出 JSON 或额外说明。
    - 回答面向用户，但内容必须忠实于当前整体状态，不能脱离已经成立的信息。
    - 优先吸收 reference_scope、your_notes、history、runtime_artifacts 中已经成立的信息，再组织成自然回复。
    - 不要遗漏会影响用户理解当前任务状态的关键信息。
    - 如果需要回复不在上下文中的内容时，在结尾单独加一行“补充说明：...”明确指出这些点来自模型通用知识而非当前本地资料。
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
