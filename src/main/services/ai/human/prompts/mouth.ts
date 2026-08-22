import type { AiRunContext } from '../../types'
import { renderDeliveryGuidanceItems } from '../shared/deliveryGuidance'
import {
  NCURATOR_REF_MARKDOWN_FORMAT_EXAMPLE,
  renderEvidenceReferences
} from '../shared/references'
import { renderHumanFileChangeLines } from '../shared/runtimeRenderers'
import type { HumanState } from '../types'

export const buildMouthDeliveryMessage = (input: {
  state: HumanState
  ctx: AiRunContext
}): string =>
  `
现在请基于以上完整执行历史，面向用户交付最终结果。

交付要求：
- 只输出最终 markdown 正文，不要输出 JSON 或额外说明。
- 必须严格依据执行历史中已发生的事实回答，优先回答用户真正关心的内容，使用自然、直接、容易理解的表达。
- 当 file_changes 存在时，必须提及这些产出。
- 当 delivery_guidance 存在时，必须吸收。
- 当 evidence_references 存在时，必须吸收其中信息，明确说明引用了哪些资料来分别支撑了哪部分交付内容。
- 禁止编造不存在的事实；禁止改动客观事实的锚点（文件名、路径、资料名、工具名、人物职责绑定等），必须复用原文锚点。
- 如果任务结果已经体现在文件、命令结果或其他产物中，默认只总结结果，不要把产物正文或大段原始输出直接作为最终答复主体。
- 文件或网页链接必须使用 Markdown 格式：[显示名称](ncurator://ref?kind=normal|reference&resourceType=file|web&label=显示名称&path=文件路径或网页URL)，样例：${NCURATOR_REF_MARKDOWN_FORMAT_EXAMPLE}。
- evidence_references 中的正文引用片段是证据引用，输出时必须原样使用该链接格式，禁止修改；其他链接使用相同格式但 kind=normal。

<delivery_context>
  <delivery_guidance>
${renderDeliveryGuidanceItems(input.state.execution.deliveryGuidanceItems)}
  </delivery_guidance>

  <file_changes>
${renderHumanFileChangeLines(input.state, 'prompt')}
  </file_changes>

  <evidence_references>
${renderEvidenceReferences(input.state.execution.evidenceReferences)}
  </evidence_references>
</delivery_context>
`.trim()
