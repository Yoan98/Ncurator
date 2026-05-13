import type { AiRunContext } from '../../types'
import { renderReferenceScopeText } from '../../prompts/referenceScope'
import { HUMAN_TOOL_USE_PLAN_LIMIT } from '../constants'
import { getLastRoundFocus, getRecentHistoryRounds } from '../memory/roundHistory'
import {
  getEffectiveLearnedSkillIds,
  getSkillDefinition,
  listBuiltinSkillDefinitions,
  listExternalSkillDefinitions
} from '../skills'
import { renderHumanStableNotes } from '../shared/memoryRenderers'
import { renderBrainCompactBlocks, renderBrainRoundSection } from '../shared/historyRenderers'
import { getToolSpec } from '../tools/registry'
import {
  renderBrainOutputSchemaForPrompt,
  renderToolSchemaForPrompt
} from '../tools/schemaPromptRenderer'
import { humanThoughtDecisionSchema } from '../schema'
import type { HumanState, ToolPromptExample } from '../types'
import type { HumanToolSpec } from '../tools/types'
import { renderWatchHintForBrain } from './watchHints'

const renderToolExample = (example: ToolPromptExample, index: number): string =>
  `${index + 1}. ${example.goal}\n${JSON.stringify(example.args, null, 2)}`

const indentLines = (value: string, level: number): string =>
  value
    .split('\n')
    .map((line) => `${'  '.repeat(level)}${line}`)
    .join('\n')

const renderPlatformText = (ctx: AiRunContext): string => `当前 terminal 平台：${ctx.platform}`

const renderSkillCatalogToolSpecLine = (input: {
  spec: HumanToolSpec
  skillLabels: string[]
}): string => {
  const schemaText = indentLines(renderToolSchemaForPrompt(input.spec.schema), 2)
  const examples = indentLines(input.spec.promptSpec.examples.map(renderToolExample).join('\n'), 2)
  const ownerSkills = input.skillLabels.join('、') || 'none'

  return `
- 工具 ${input.spec.name}
  - 所属技能：${ownerSkills}
  - 描述：${input.spec.promptSpec.description}
  - 适用时机：${input.spec.promptSpec.whenToUse}
  - 调用传参：
${schemaText}
  - 示例：
${examples}
`.trim()
}

const renderSkillCatalogSection = (state: HumanState): string => {
  const effectiveSkillIds = getEffectiveLearnedSkillIds(state.skills.learnedSkillIds)
  const effectiveSkillDefinitions = effectiveSkillIds.map((skillId) => getSkillDefinition(skillId))
  const learnedExternalSkillDefinitions = effectiveSkillDefinitions.filter(
    (definition) => definition.source === 'external'
  )
  const renderSkillLine = (definition: ReturnType<typeof getSkillDefinition>): string =>
    [
      `- ${definition.skillId}：${definition.description}`,
      `  - 适用场景：${definition.whenToUse}`,
      definition.source === 'builtin' ? '' : `  - learning 时填写：${definition.skillId}`
    ].join('\n')
  const learnableSkillLines = listExternalSkillDefinitions()
    .filter((definition) => !state.skills.learnedSkillIds.includes(definition.skillId))
    .map(renderSkillLine)
  const effectiveToolSpecLines = Array.from(
    new Set(effectiveSkillDefinitions.flatMap((definition) => definition.toolNames))
  )
    .map((toolName) => getToolSpec(toolName))
    .filter((spec): spec is HumanToolSpec => Boolean(spec))
    .map((spec) =>
      renderSkillCatalogToolSpecLine({
        spec,
        skillLabels: effectiveSkillDefinitions
          .filter((definition) => definition.toolNames.includes(spec.name))
          .map((definition) => definition.skillId)
      })
    )

  return `
skill是一项技能，一项技能通常会对应一个或多个tool，tool则是你最终会实际使用且用来完成事项的工具。

始终可用的技能：
${listBuiltinSkillDefinitions().map(renderSkillLine).join('\n') || 'none'}

已经学习的技能：
${learnedExternalSkillDefinitions.map(renderSkillLine).join('\n') || 'none'}

仍可补充学习的技能：
${learnableSkillLines.join('\n') || 'none'}

当前可直接调用的工具：
${effectiveToolSpecLines.join('\n') || 'none'}
`.trim()
}

export const buildBrainPrompt = (input: {
  state: HumanState
  ctx: AiRunContext
  sessionMemoryText?: string
  recentConversationText?: string
}) => {
  const outputShapeText = indentLines(
    renderBrainOutputSchemaForPrompt(humanThoughtDecisionSchema),
    1
  )
  const system = `
<system>
  <principles>
    - 像一个判断稳定的人类执行者一样工作：先理解任务目标，再结合当前记忆、真实执行结果和可用能力，自主判断下一步。
    - 你会收到任务、记忆、技能、历史和提示等不同类型的信息；这些信息主要是帮助你理解局面，不代表固定流程。
    - 禁止编造事实、证据、能力、工具结果或并未发生的过程。
    - 当存在显式参考资料时，必须优先使用这些本地信息来理解和完成任务。
    - 当你觉得用户诉求接近完成时，必须做一遍检查工作，检查是否真的能完成用户诉求的交付；
  </principles>

  <thought_contract>
    - thought.summary：一句话概括你本轮的判断或下一步意图。
  </thought_contract>

  <next_action_contract>
    nextAction的选择：
    - nextAction 只能在 learning、hand、mouth 三者中选择其一。
    - 选择 learning：当你已经知道缺少哪类能力说明，且补齐后能明显降低不确定性时。
    - 选择 hand：当下一步已经明确成一批工具调用，且你能给出完整合法的 toolUsePlan 时。
    - 选择 mouth：只在当前已经足够形成最终交付时；mouth 不新增事实，不继续执行工具。

    nextAction为hand时：
    - toolUsePlan 必须是完整合法的可执行计划。
    - toolUsePlan.mode：parallel 只用于只读且彼此独立、并行安全的调用；其余情况必须用 serial,它将是被串行执行。
    - toolUsePlan.calls[*].toolName：必须严格使用当前工具说明里的精确名称。
    - toolUsePlan.calls[*].args：必须是对象，字段名、必填参数和参数层级都必须与工具说明一致。
    - toolUsePlan最大只允许规划${HUMAN_TOOL_USE_PLAN_LIMIT}个。

    nextAction为mouth时：
    - 若完成用户诉求时引用了本地资料，或引用了不来自本地资料的知识以及外部资料必须在 nextAction.references 中列出这些资料，并说明来源定位与它支撑了最终交付的哪些地方。
    - references[*].kind,分为internal和external,分别代表着用户本地资料和外部资料。
    - references[*].label,为资料名，比如文件名也可能是网页名等。
    - references[*].path,为地址，比如文件地址，网页地址等，如果是非用户本地的资料，但又没有明确路径则可以写为From LLM。
    - references[*].usedFor 必须明确描述“这条资料支撑了最终答复中的哪部分内容”，不能只写笼统用途。
  </next_action_contract>

  <stable_memory_contract>
    - stableMemory 是任务推进中的持续工作记忆，目标是帮助你维持当前推进判断，因此应始终追求最小但最有效。

    - currentUnderstanding：
      用于记录你当前对任务推进局面的最新理解。
      它应保留当前仍影响推进的关键信息，通常包括：当前目标、当前进度、当前限制或风险、下一步。
      不要在这里展开证据细节，不要重复转写工具结果正文，不要保留已经失效的旧路径。
      当局面变化时，应直接重写成新的最新理解，而不是在旧文本后不断追加。

    - keyEvidence：
      用于记录支撑 currentUnderstanding 的当前有效依据。
      它应由你整理成一组精简证据链，每条证据只说明“来源对象 + 关键定位 + 它支持了什么判断”。
      不要重复转写原文，不要把工具结果全文搬进来，不要写成长篇资料摘要。
      这里只保留当前仍在支撑判断的依据；已经失效或已不再需要的依据应删除。

    - checklist：
      用于记录任务推进状态、已覆盖范围、待做项和失效路径。
      checklist 必须是结构化数组；每项只包含 item 和 status 两个字段。
      status 只能使用 todo / done / obsolete。
      如果你输出 checklist，必须给出基于旧内容整理后的完整最新版本，而不是只写局部变更。

    -updatedStableMemory输出规则：
      updatedStableMemory是可选字段；缺失表示本轮不更新 stableMemory。
      updatedStableMemory中每个字段必须是按需输出的，只有当觉得该字段内容需要更新时，才输出该字段，不输出对应字段则代表则不更新。
      在输出前，先逐字段自检，真的需要更新currentUnderstanding吗？真的需要更新keyEvidence吗？真的需要更新checklist吗？
  </stable_memory_contract>

  <context_block_guide>
    - task_goal：用户原始诉求与限制。
    - reference_scope：当前工作区、默认知识范围、显式缩圈范围和可用边界。
    - search_strategy：当前任务默认遵循的检索思路提示。
    - terminal_platform：当前 terminal 所在平台；如果你决定使用命令行，应据此选择命令语法。
    - your_notes：稳定任务笔记，按“当前理解 / 关键依据 / 检查清单”组织。
    - session_memory：当前会话中跨任务仍有效的滚动摘要，用于理解用户在同一窗口里的连续主线、稳定偏好与当前状态。
    - recent_conversation：最近几轮真实对话内容与产物，用于判断用户刚刚说了什么、你刚刚交付了什么。
    - compact_blocks：当前任务中已压缩的过程历史，用于识别较早事实、失败路径和已验证动作。
    - recent_history：当前任务中最近未压缩的过程历史，用于判断最近已经做过什么。
    - latest_history：最近一轮完整过程记录，用于判断刚做了什么、传了什么参数、拿到了什么结果。
    - skill_catalog：当前已生效或仍可学习的 skills，以及当前可直接调用的工具说明。
    - correction_hint：当前额外的收敛或纠偏提示；若无则为 none。
  </context_block_guide>

  <output_contract>
    - 你必须只输出 JSON，不要输出任何额外说明，也不要输出 markdown。
    - 输出内容必须符合 output_shape。
    - 禁止输出与 output_shape 无关的附加字段。
  </output_contract>

  <output_shape>
${outputShapeText}
  </output_shape>

  <examples>
    <example_learning>
      {
        "thought": {
          "summary": "先学习当前缺失的技能",
        },
        "nextAction": {
          "action": "learning",
          "wantLearnSkillIds": ["docx-read"]
        }
      }
    </example_learning>

    <example_tool_plan>
      {
        "thought": {
          "summary": "下一步已经明确，准备执行真实工具调用。",
        },
        "nextAction": {
          "action": "hand",
          "toolUsePlan": {
            "mode": "serial",
            "calls": [
              {
                "toolName": "terminal_run",
                "args": {
                  "command": "pwd"
                }
              }
            ]
          }
        }
      }
    </example_tool_plan>

    <example_delivery>
      {
        "updatedStableMemory": {
          "currentUnderstanding": "- 已确认审批驳回时原文件保持不变。",
          "keyEvidence": "- kb_search 命中了审批驳回时保留原文件的制度说明。",
          "checklist": [
            {
              "item": "确认审批驳回时是否保留原文件",
              "status": "done"
            }
          ]
        },
        "thought": {
          "summary": "证据已经足够，准备结束任务"
        },
        "nextAction": {
          "action": "mouth",
          "references": [
            {
              "label": "审批制度说明.docx",
              "path": "/workspace/审批制度说明.docx",
              "kind": "internal",
              "usedFor": "用于支撑最终答复中“审批驳回时保留原文件”的结论"
            }
          ]
        }
      }
    </example_delivery>
  </examples>
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

  <terminal_platform>
${renderPlatformText(input.ctx)}
  </terminal_platform>

  <skill_catalog>
${renderSkillCatalogSection(input.state)}
  </skill_catalog>

  <memory>
    <session_memory>
    ${input.sessionMemoryText || 'none'}
    </session_memory>

    <recent_conversation>
    ${input.recentConversationText || 'none'}
    </recent_conversation>

    <history>
      <compact_blocks>
      ${renderBrainCompactBlocks(input.state.memory.history.compactBlocks)}
      </compact_blocks>

      <recent_history>
      ${renderBrainRoundSection(getRecentHistoryRounds(input.state))}
      </recent_history>

      <latest_history>
      ${renderBrainRoundSection(getLastRoundFocus(input.state) ? [getLastRoundFocus(input.state)!] : [])}
      </latest_history>
    </history>

    <your_notes>
    ${renderHumanStableNotes(input.state, 'brain_prompt')}
    </your_notes>
  </memory>

  <correction_hint>
${input.state.execution.watchHint ? renderWatchHintForBrain(input.state.execution.watchHint) : 'none'}
  </correction_hint>
</user_context>
`.trim()

  return {
    system,
    user
  }
}
