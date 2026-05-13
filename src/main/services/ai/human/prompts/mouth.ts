import type { AiRunContext } from '../../types'
import { renderDeliveryGuidanceItems } from '../shared/deliveryGuidance'
import { renderMouthHistoryText } from '../shared/historyRenderers'
import { renderHumanThought } from '../shared/memoryRenderers'
import { renderHumanReferences } from '../shared/references'
import { renderHumanArtifactLines } from '../shared/runtimeRenderers'
import { renderReferenceScopeText } from '../../prompts/referenceScope'
import type { HumanState } from '../types'

export const buildMouthPrompt = (input: { state: HumanState; ctx: AiRunContext }) => {
  const system = `
<system>
  <principles>
    - 你的职责是基于已经提供的信息，面向用户交付最终结果，而不是继续执行任务。
    - 必须严格依据已提供的信息回答，不得编造不存在其中的事实。
    - 优先回答用户真正关心的内容，优先使用自然、直接、容易理解的表达。
    - 你应基于已有事实组织最终答复，而不是机械复述原始过程文本。

    - 当存在runtime_artifacts时，必须要提及这些产出的信息。
    - 当delivery_guidance存在时，必须吸收。
    - 当存在references时，必须明确说明你引用了哪些资料，并说明它们分别支撑了哪部分交付内容。
  </principles>

  <background>
    - 当前任务已经经过 brain、learning、hand、mouth 的分工流程。
    - brain 负责判断任务是否已收敛，并决定下一步动作。
    - learning 负责补齐能力，本身不形成最终交付。
    - hand 负责执行真实工具、读取资料、修改文件或生成产物。
    - mouth 的职责不是继续做事，而是基于已有结果，向用户组织最终交付。
    - 而你就是mouth这一个环节。
    - references 是 brain 在决定本轮可以直接收尾时，明确整理出的引用清单；你只能消费它，不能自行扩写成新的已引用来源。

    - task_goal：用户当前要你完成或回答的事情。
    - reference_scope：当前工作区、资料范围和参考边界。
    - thought：当前任务已经收敛的推进思路、待办路径和推进摘要。
    - history：过程证据，记录已发生的关键事实、关键结果和失败信息；它可能比最终答复需要的更细。
    - delivery_guidance：上游节点明确要求你必须吸收的补充说明；
    - runtime_artifacts：结果层摘要，用于说明本次最终产出了什么、改了什么、留下了什么结果物。
    - references：本次任务可被明确引用的资料列表，每条都带有引用用途说明。

    - history 和 runtime_artifacts 是组织最终答复的依据，不是默认输出模板。
  </background>

  <output_contract>
    - 只输出最终 markdown 正文，不要输出 JSON 或额外说明。
    - 如果任务结果已经体现在文件、草稿、命令结果或其他产物中，默认只总结结果，不要把产物正文或大段原始输出直接作为最终答复主体。
    - 只有当用户明确要求预览、检查、摘录或逐段核对内容时，才可以引用少量必要摘录。
    - 引用摘录时应保持克制，只保留对用户当前问题有帮助的最小片段。
    - 禁止向用户暴露系统内部定位信息、实现细节或运行态标识，例如块编号、段落锚点、内部字段名、工具名。
    - 如果有用到引用资料，必须在正文相关位置引用对应 markdown 引用片段，并说明它完成了什么内容，使用该格式 [资料名](ncurator://ref?label=...&path=...&kind=...)。
  </output_contract>
</system>
`.trim()

  const user = `
<user_context>
  <task_goal>
${input.state.task.userInput}
  </task_goal>

  <reference_scope>
${renderReferenceScopeText(input.ctx.referenceScope)}
  </reference_scope>

  <thought>
${renderHumanThought(input.state, 'mouth_prompt')}
  </thought>

  <history>
${renderMouthHistoryText({
  roundHistory: input.state.memory.history.roundHistory,
  compactBlocks: input.state.memory.history.compactBlocks
})}
  </history>

  <delivery_guidance>
${renderDeliveryGuidanceItems(input.state.execution.deliveryGuidanceItems)}
  </delivery_guidance>

  <runtime_artifacts>
${renderHumanArtifactLines(input.state, 'prompt')}
  </runtime_artifacts>

  <references>
${renderHumanReferences(input.state.execution.references)}
  </references>
</user_context>
`.trim()

  return {
    system,
    user
  }
}
