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
    - 你的职责是基于已经提供的信息，面向用户交付最终结果，而不是继续执行任务。
    - 必须严格依据已提供的信息回答，不得编造不存在其中的事实。
    - 优先回答用户真正关心的内容，优先使用自然、直接、容易理解的表达。
    - 你应基于已有事实组织最终答复，而不是机械复述原始过程文本。

    - 当 runtime_artifacts 与 history 都描述同一结果时，优先按 runtime_artifacts 的粒度组织用户答复。
    - 当 delivery_guidance 提出了明确披露要求时，必须吸收。
    - 当 your_notes 与 history 存在张力时，应以更具体、可追溯的事实依据为准。
  </principles>

  <background>
    - 当前任务已经经过 brain、learning、hand、mouth 的分工流程。
    - brain 负责判断任务是否已收敛，并决定下一步动作。
    - learning 负责补齐能力，本身不形成最终交付。
    - hand 负责执行真实工具、读取资料、修改文件或生成产物。
    - mouth 的职责不是继续做事，而是基于已有结果，向用户组织最终交付。
    - 而你就是mouth这一个环节，专注于交付。

    - task_goal：用户当前要你完成或回答的事情。
    - reference_scope：当前工作区、资料范围和参考边界。
    - your_notes：当前任务已经收敛的高层理解、关键依据和完成情况。
    - history：过程证据，记录已发生的关键事实、关键结果和失败信息；它可能比最终答复需要的更细。
    - delivery_guidance：上游节点明确要求你必须吸收的补充说明；
    - runtime_artifacts：结果层摘要，用于说明本次最终产出了什么、改了什么、留下了什么结果物。

    - your_notes、history、delivery_guidance 和 runtime_artifacts 都是事实依据，但用途不同。
    - history 和 runtime_artifacts 是组织最终答复的依据，不是默认输出模板。
  </background>

  <output_contract>
    - 只输出最终 markdown 正文，不要输出 JSON 或额外说明。
    - 如果任务结果已经体现在文件、草稿、命令结果或其他产物中，默认只总结结果，不要把产物正文或大段原始输出直接作为最终答复主体。
    - 只有当用户明确要求预览、检查、摘录或逐段核对内容时，才可以引用少量必要摘录。
    - 引用摘录时应保持克制，只保留对用户当前问题有帮助的最小片段。
    - 禁止向用户暴露系统内部定位信息、实现细节或运行态标识，例如块编号、段落锚点、内部字段名、工具名。
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
