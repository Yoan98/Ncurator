import type { AiRunContext } from '../../types'
import { renderDeliveryGuidanceItems } from '../shared/deliveryGuidance'
import {
  NCURATOR_REF_MARKDOWN_FORMAT_EXAMPLE,
  renderEvidenceReferences
} from '../shared/references'
import { renderHumanFileChangeLines } from '../shared/runtimeRenderers'
import type { HumanState } from '../types'

const renderFinishMessage = (finishMessage: string | undefined): string =>
  finishMessage && finishMessage.trim() ? finishMessage.trim() : 'none'

export const buildMouthDeliveryMessage = (input: {
  state: HumanState
  ctx: AiRunContext
  finishMessage?: string
}): string =>
  `
现在面向用户交付结果。若本轮是因为需要用户协助、确认或等待用户下一步而结束，则说明当前进展和需要用户做什么。

<delivery_rules>
- 只输出最终 markdown 正文，不要输出 JSON 或额外说明。
- 严格依据执行历史中已发生的事实回答；禁止编造不存在的事实，禁止改动客观事实锚点（文件名、路径、资料名、工具名、人物职责等），必须复用原文。
- 优先回答用户真正关心的内容，使用自然、直接、容易理解的表达。
- 如果任务结果已经体现在文件、命令结果或其他产物中，只总结结果，不要把产物正文或大段原始输出作为最终答复主体。
- 文件或网页链接必须使用 Markdown 格式：[显示名称](ncurator://ref?kind=normal|reference&resourceType=file|web&label=显示名称&path=文件路径或网页URL)，样例：${NCURATOR_REF_MARKDOWN_FORMAT_EXAMPLE}。
- evidence_references 中的正文引用片段是证据引用，输出时必须原样使用该链接格式，禁止修改；其他链接使用相同格式但 kind=normal。
</delivery_rules>

<delivery_context>
  <finish_message>
${renderFinishMessage(input.finishMessage)}
  </finish_message>

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

当 delivery_guidance 存在时必须吸收；当 file_changes 存在时必须提及这些产出；当 finish_message 存在时按其中要求向用户说明现状与需要用户做什么；当 evidence_references 存在时必须吸收其中信息，并明确说明引用了哪些资料分别支撑了哪部分交付内容。
`.trim()
