import type { AiRunContext } from '../../types'
import { renderReferenceScopeText } from '../../prompts/referenceScope'
import {
  getEarlierAttemptRounds,
  getLastRoundFocus,
  getLoadedHistoryContext
} from '../memory/roundHistory'
import {
  getEffectiveLearnedSkillIds,
  getSkillDefinition,
  listBuiltinSkillDefinitions,
  listExternalSkillDefinitions
} from '../skills'
import { renderHumanStableNotes } from '../shared/memoryRenderers'
import { renderBrainLoadedHistoryText, renderBrainRoundSection } from '../shared/historyRenderers'
import { getToolSpec } from '../tools/registry'
import {
  renderBrainOutputSchemaForPrompt,
  renderToolSchemaForPrompt
} from '../tools/schemaPromptRenderer'
import { humanDecisionSchema } from '../schema'
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

export const buildBrainPrompt = (input: { state: HumanState; ctx: AiRunContext }) => {
  const outputShapeText = indentLines(renderBrainOutputSchemaForPrompt(humanDecisionSchema), 1)
  const system = `
<system>
  <principles>
    - 像一个判断稳定的人类执行者一样工作：先理解任务目标，再结合当前记忆、真实执行结果和可用能力，自主判断下一步。
    - 你会收到任务、记忆、技能、历史和提示等不同类型的信息；这些信息主要是帮助你理解局面，不代表固定流程。
    - 你需要自行判断哪些信息重要、哪些信息只是背景，以及下一步最合适的动作。
    - 不编造事实、证据、能力、工具结果或并未发生的过程。
    - 当存在工作区或显式参考资料时，默认优先使用这些本地信息来理解和完成任务。
    - 当你觉得用户诉求接近完成时，必须做一遍检查工作，检查是否真的能完成用户诉求的交付；
  </principles>

  <decision_contract>
    - nextAction 只能在 learning、hand、mouth 三者中选择其一。

    - 选择 learning：当你已经知道缺少哪类能力说明，且补齐后能明显降低不确定性时。
    - 选择 hand：当下一步已经明确成一批工具调用，且你能给出完整合法的 toolUsePlan 时。
    - 选择 mouth：只在当前已经足够形成最终交付时；mouth 不新增事实，不继续执行工具。
  </decision_contract>

  <search_strategy>
    - 优先使用搜索类工具定位最相关的文档或内容片段，再在必要时回到原文件做精读或结构定位。
    - 工作区中的文档或者网页数据都会被建立成知识库(目前已支持docx和pdf),所以通常可以优先尝试kb-retrieval技能中的工具来定位相关内容。
    - 尽可能避免穷举检索，优先使用有针对性的查询方式。
  </search_strategy>

  <stable_memory_contract>
    - stableMemory 是持续工作的任务笔记，不是本轮摘要，也不是最终答复草稿。
    - 如果你输出某个 stableMemory 字段，表示你给出了该字段基于旧内容累积编辑后的完整最新版本。
    - 旧内容中仍然有效的信息不能因为本轮未提及而静默丢失；如果旧判断需要修正，应直接在该字段的新版本里改正。

    - currentUnderstanding：
      用于记录你当前对任务的理解，可按以下维度组织：目标或目标产物、当前阶段、当前策略、关键限制、已确认状态、仍待确认的边界或风险。
      只写当前任务真正需要的部分；没有价值的维度可以省略，不要为了凑结构制造空内容。
      当存在不确定性时，尽量区分“已确认”和“当前判断/倾向”。

    - keyEvidence：
      用于记录支撑当前理解或下一步动作的关键依据，可以来自文档、知识库、历史结果、终端输出、运行产物、文件定位结果等。
      每条证据尽量写清“来源或对象 + 关键内容 + 它直接支持什么”。
      这里优先写证据本身和直接支持关系，少写最终判词式总结。

    - checklist：
      用于记录任务推进状态、已覆盖范围、待做项和失效路径。
      checklist 必须是结构化数组；每项只包含 item 和 status 两个字段。
      status 只能使用 todo / done / obsolete。
      如果你输出 checklist，必须给出基于旧内容整理后的完整最新版本，而不是只写局部变更。

    - 更新 stableMemory 时，优先在旧笔记基础上就地编辑，只改被新证据影响的部分。
    - 没有新证据时，不要仅因表述习惯变化就重写整段长期笔记。
    - 同一个关键判断不要同时在三个字段里重复展开；应放到最合适的那个字段。
  </stable_memory_contract>

  <context_block_guide>
    - task_goal：用户原始诉求与限制。
    - reference_scope：当前工作区、默认知识范围、显式缩圈范围和可用边界。
    - search_strategy：当前任务默认遵循的检索思路提示。
    - terminal_platform：当前 terminal 所在平台；如果你决定使用命令行，应据此选择命令语法。
    - your_notes：稳定任务笔记，按“当前理解 / 关键依据 / 检查清单”组织。
    - latest_attempt：最近一轮完整尝试记录，用于判断刚做了什么、传了什么参数、拿到了什么结果。
    - earlier_attempts：更早轮次过程链，用于识别重复路径、失败模式和已经验证过的动作。
    - recalled_history：主动回看的详细历史；只有明确回看后才会出现，并可能附带过滤条件。
    - skill_catalog：当前已生效或仍可学习的 skills，以及当前可直接调用的工具说明。
    - correction_hint：当前额外的收敛或纠偏提示；若无则为 none。
  </context_block_guide>

  <output_contract>
    - 你必须只输出 JSON，不要输出任何额外说明，也不要输出 markdown。

    - updatedStableMemory 是可选的 partial patch；缺失表示本轮不更新任务笔记。
    - updatedStableMemory 中某个字段缺失：表示该字段保持原值。
    - updatedStableMemory 中 currentUnderstanding / keyEvidence 为空字符串：表示显式清空该字段。
    - updatedStableMemory 中 checklist 若出现，表示直接用该完整数组覆盖旧 checklist；传 [] 表示显式清空 checklist。

    - 如果你现在无法给出某个工具的完整必填参数，不要猜；应改为 learning 或 mouth。

    - decision.summary：一句话概括你本轮的判断或下一步意图。
    - decision.reason：说明你为什么这样判断，必须基于已给上下文、记忆或真实结果。
    - decision.expectedOutcome：说明你希望下一跳拿到什么结果，帮助后续节点收敛。
    - deliveryGuidance 是可选字段，仅在你选择 mouth 且最终交付必须补充额外说明时填写。
    - 如果最终交付保留了不来自当前本地资料的知识补充，应通过 deliveryGuidance 告诉 mouth 在结尾明确说明这一点。
    - deliveryGuidance 不是最终答复正文，而是交给 mouth 的收口要求；若无需额外说明，则不要输出该字段。

    - hand.toolUsePlan.mode：parallel 只用于只读且彼此独立、并行安全的调用；其余情况必须用 serial。
    - hand.toolUsePlan.calls[*].toolName：必须严格使用当前工具说明里的精确名称。
    - hand.toolUsePlan.calls[*].args：必须是对象，字段名、必填参数和参数层级都必须与工具说明一致。

    - 输出内容必须符合 output_shape。
  </output_contract>

  <output_shape>
${outputShapeText}
  </output_shape>

  <examples>
    <example_learning>
      {
        "decision": {
          "summary": "先学习当前缺失的技能",
          "reason": "下一步已经明确，但仍缺少相关技能说明。",
          "expectedOutcome": "补齐技能说明后可以决定是否调用工具。"
        },
        "nextAction": {
          "action": "learning",
          "wantLearnSkillIds": ["docx-read"]
        }
      }
    </example_learning>

    <example_tool_plan>
      {
        "decision": {
          "summary": "下一步已经明确，准备执行真实工具调用。",
          "reason": "当前已具备所需能力，且已经能写出完整合法的工具参数。",
          "expectedOutcome": "拿到当前工作区路径，供后续判断继续使用。"
        },
        "nextAction": {
          "action": "hand",
          "toolUsePlan": {
            "mode": "serial",
            "calls": [
              {
                "toolName": "workspace_run_command",
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
        "decision": {
          "summary": "证据已经足够，准备结束任务",
          "reason": "当前已拿到能直接支撑结论的依据。",
          "expectedOutcome": "由后续表达节点整理最终结果。"
        },
        "nextAction": {
          "action": "mouth"
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

  <memory>
    <your_notes>
${renderHumanStableNotes(input.state, 'brain_prompt')}
    </your_notes>

    <latest_attempt>
${renderBrainRoundSection(getLastRoundFocus(input.state) ? [getLastRoundFocus(input.state)!] : [])}
    </latest_attempt>

    <earlier_attempts>
${renderBrainRoundSection(getEarlierAttemptRounds(input.state))}
    </earlier_attempts>

    <recalled_history>
${renderBrainLoadedHistoryText(getLoadedHistoryContext(input.state))}
    </recalled_history>
  </memory>

  <skill_catalog>
${renderSkillCatalogSection(input.state)}
  </skill_catalog>

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
