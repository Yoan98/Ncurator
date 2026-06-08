import type { AiRunContext } from '../../types'
import { renderDeliveryGuidanceItems } from '../shared/deliveryGuidance'
import {
  renderBrainCompactBlocks,
  renderBrainRoundExecutionOnly,
  renderBrainRoundSection
} from '../shared/historyRenderers'
import { renderTaskProgress } from '../shared/memoryRenderers'
import { NCURATOR_REF_MARKDOWN_FORMAT_EXAMPLE, renderHumanReferences } from '../shared/references'
import { renderHumanFileChangeLines } from '../shared/runtimeRenderers'
import { renderReferenceScopeText } from '../../prompts/referenceScope'
import type { HumanState } from '../types'
import { getLastRoundFocus, getRecentHistoryRounds } from '../memory/rounds'

export const buildMouthPrompt = (input: {
  state: HumanState
  ctx: AiRunContext
  conversationSummaryText?: string
  recentTurnsText?: string
}) => {
  const latestRound = getLastRoundFocus(input.state)
  const system = `
<system>
  <principles>
    - 你的职责是基于已经提供的信息，面向用户交付最终结果，而不是继续执行任务。
    - 必须严格依据已提供的信息回答，优先回答用户真正关心的内容，使用自然、直接、容易理解的表达。

    - 当存在file_changes时，必须要提及这些产出的信息。
    - 当delivery_guidance存在时，必须吸收。
    - 当存在references时，必须吸收其中信息，明确说明引用了哪些资料来分别支撑了哪部分交付内容。

    - 禁止编造不存在其中的事实。
    - 禁止对客观事实进行改动描述，比如文件名、路径、资料名、工具名、人物职责绑定等已经有明确标识的对象，必须复用原文锚点。
    - 禁止向用户暴露系统内部定位信息、实现细节或运行态标识，例如块编号(如b:xxx这类内部工具的标定为)、段落锚点、内部字段名、工具名等。
  </principles>

  <context_block_guide>

    - task_goal：用户当前要你完成或回答的事情。
    - reference_scope：当前工作区、资料范围和参考边界。
    - conversation_history：当前会话历史视图，用于理解这次最终交付与同一会话前文的连续性。
    - task_progress：当前任务已经收敛的全局进度信息，包含待办路径、推进摘要，以及最新一轮判断和执行。
    - round_history：当前任务的历史证据视图，包含已压缩的较早历史和较新的真实轮次记录。
    - delivery_guidance：上游节点明确要求你必须吸收的补充说明。
    - file_changes：本次实际修改的文件记录，用于说明本次最终修改了什么文件。
    - references：本次任务可被明确引用的资料列表，每条都带有引用用途说明。
  </context_block_guide>

  <output_contract>
    - 只输出最终 markdown 正文，不要输出 JSON 或额外说明。
    - 如果任务结果已经体现在文件、命令结果或其他产物中，默认只总结结果，不要把产物正文或大段原始输出直接作为最终答复主体。
    - 最终答复中的任何可点击链接都必须严格使用 ncurator://ref markdown 格式，样例：${NCURATOR_REF_MARKDOWN_FORMAT_EXAMPLE}
    - references 中的正文引用片段是证据引用，必须原样使用；其他链接使用相同格式但 kind=normal。
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

  <conversation_history>
    <summary>
    ${input.conversationSummaryText || 'none'}
    </summary>

    <recent_turns>
    ${input.recentTurnsText || 'none'}
    </recent_turns>
  </conversation_history>

  <task_progress>
${renderTaskProgress({
  state: input.state,
  latestRound,
  latestExecutionText: renderBrainRoundExecutionOnly(latestRound),
  mode: 'mouth_prompt'
})}
  </task_progress>

  <round_history>
    <compactions>
    ${renderBrainCompactBlocks(input.state.memory.taskRun.compactions)}
    </compactions>

    <rounds>
    ${renderBrainRoundSection(getRecentHistoryRounds(input.state))}
    </rounds>
  </round_history>

  <delivery_guidance>
${renderDeliveryGuidanceItems(input.state.execution.deliveryGuidanceItems)}
  </delivery_guidance>

  <file_changes>
${renderHumanFileChangeLines(input.state, 'prompt')}
  </file_changes>

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
