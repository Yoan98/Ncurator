import type { AiRunContext } from '../../types'
import { renderReferenceScopeText } from '../../prompts/referenceScope'
import { HUMAN_TOOL_USE_PLAN_LIMIT } from '../constants'
import { getLastRoundFocus, getRecentHistoryRounds } from '../memory/rounds'
import {
  getEffectiveLearnedSkillIds,
  getSkillDefinition,
  listBuiltinSkillDefinitions,
  listExternalSkillDefinitions
} from '../skills'
import { renderTaskProgress } from '../shared/memoryRenderers'
import {
  renderBrainCompactBlocks,
  renderBrainRoundExecutionOnly,
  renderBrainRoundSection
} from '../shared/historyRenderers'
import { getToolSpec } from '../tools/registry'
import {
  renderBrainOutputSchemaForPrompt,
  renderToolSchemaForPrompt
} from '../tools/schemaPromptRenderer'
import { humanThoughtDecisionSchema } from '../schema'
import type { HumanState, ToolPromptExample } from '../types'
import type { HumanToolSpec } from '../tools/types'
import { renderDecisionHintForBrain } from './decisionHints'

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
  conversationSummaryText?: string
  recentTurnsText?: string
}) => {
  const latestRound = getLastRoundFocus(input.state)
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
    - thought 是你对当前任务推进状态的可展示工作思路，不是隐藏推理链。

    - thought.next：
    - 它是每轮必须输出字段。
    - 该字段必须输出当前现状是什么和下一步该做什么才能推进用户的任务诉求,通过简洁一句话的形式描述。

    - thought.todolist：
    - 它是可选择输出的字段；只有行动路径需要初始化或调整时才输出；如果没有变动，禁止输出；一旦输出必须是完整最新数组，会全量覆盖旧 todolist。
    - 该字段必须输出根据用户任务诉求拆出的行动路径，它是可变的，允许任务推进中因为发现更好的解决或无法推进而调整、废弃、重排。
    - 它每项只包含 item 和 status，status 只能是 todo / done,其中todo表示待办，done表示已完成。
    - 它最后一项必须是检查项，用于检查是否已经满足用户任务诉求并能进入最终交付。

    - thought.progressionSummary：
    - 它是可选择输出的字段；只有推进理解、证据、失败原因或修正结论发生变化时才输出，如果没有变动，禁止输出；一旦输出会全量覆盖旧 progressionSummary。
    - 它不是逐轮流水账，只保留仍影响任务推进和最终交付的事项；
    - 该子段必须输出对任务推进状态的累积性理解摘要，必须严格按照下方格式输出信息，按照每个todolist项的顺序来组织如下内容：
      1.项1的名称:
        - 已经尝试过什么
        - 形成了什么结论
        - 证据是什么
      2.项2的名称:
        - xx
  </thought_contract>

  <next_action_contract>
    nextAction的选择：
    - nextAction 只能在 learning、hand、mouth 三者中选择其一。
    - 选择 learning：当你已经知道缺少哪类能力说明，且补齐后能明显降低不确定性时。
    - 选择 hand：当下一步已经明确成一批工具调用，且你能给出完整合法的 toolUsePlan 时。
    - 选择 mouth：只在当前已经足够形成最终交付时；mouth 不新增事实，不继续执行工具。

    nextAction为hand时：
    - toolUsePlan 必须是完整合法的可执行计划。
    - toolUsePlan.mode：parallel 只用于只工具的并行调用；其余情况必须用 serial,它将是被串行执行。
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

  <context_block_guide>
    - task_goal：用户的任务诉求。
    - reference_scope：当前工作区、默认知识范围、显式缩圈范围和可用边界。
    - search_strategy：当前任务默认遵循的检索思路提示。
    - terminal_platform：当前 terminal 所在平台；如果你决定使用命令行，应据此选择命令语法。
    - conversation_history：当前会话历史视图。
    - summary：当前会话中跨任务仍有效的滚动摘要，用于理解用户在同一窗口里的连续主线、稳定偏好与当前状态。
    - recent_turns：最近几轮真实对话内容与产物，用于判断用户刚刚说了什么、你刚刚交付了什么。
    - round_history：当前任务的历史证据视图。
    - compactions：已压缩的较早历史，用于保留仍相关的客观事实、失败路径、重复尝试与背景信息。
    - rounds：最近未压缩的历史轮次，用于查看较新的判断、执行与结果轨迹。
    - task_progress：当前任务的全局进度信息。
    - skill_catalog：当前已生效或仍可学习的 skills，以及当前可直接调用的工具说明。
    - decision_hint：当前额外的收敛或纠偏提示；若无则为 none。
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
          "next": "当前缺少读取 docx 的能力说明，先补齐读取能力再继续判断资料内容。",
          "todolist": [
            {
              "item": "补齐读取 docx 的能力说明",
              "status": "todo"
            },
            {
              "item": "检查是否已经满足用户诉求并能进入最终交付",
              "status": "todo"
            }
          ],
          "progressionSummary": "
            1.补齐读取 docx 的能力说明：
            - 已经尝试过什么：
            当前没有明确的工具调用计划，无法判断是否满足用户诉求。
            - 形成了什么结论：
            缺少读取 docx 的能力说明。
            - 证据是什么：
            当前工具目录里没有可用的读取 docx 的工具，无法形成明确的工具调用计划。
            2.检查是否已经满足用户诉求并能进入最终交付：
            - 已经尝试过什么：
            当前没有明确的工具调用计划，无法判断是否满足用户诉求。
            - 形成了什么结论：
            无法判断是否满足用户诉求。
            - 证据是什么：
            当前工具目录里没有可用的读取 docx 的工具，无法形成明确的工具调用计划。
           "
          "
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
          "next": "当前缺少工作区文件事实，先读取当前目录建立资料范围。"
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
        "thought": {
          "next": "审批驳回是否保留原文件已经确认，当前证据足够进入最终交付。",
          "todolist": [
            {
              "item": "确认审批驳回时是否保留原文件",
              "status": "done"
            },
            {
              "item": "检查是否已经满足用户诉求并能进入最终交付",
              "status": "done"
            }
          ],
          "progressionSummary": "
            1.确认审批驳回时是否保留原文件：
            - 已经尝试过什么：
            查看了审批制度说明.docx文件的相关内容。
            - 形成了什么结论：
            审批驳回时会保留原文件。
            - 证据是什么：
            审批制度说明.docx文件中明确说明了审批驳回时会保留原文件。

            2.检查是否已经满足用户诉求并能进入最终交付：
            - 已经尝试过什么：
            根据审批制度说明.docx文件的内容，判断了审批驳回时是否保留原文件。
            - 形成了什么结论：
            审批驳回时会保留原文件，因此满足用户诉求。
            - 证据是什么：
            审批制度说明.docx文件中明确说明了审批驳回时会保留原文件。
          "
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

  <conversation_history>
    <summary>
    ${input.conversationSummaryText || 'none'}
    </summary>

    <recent_turns>
    ${input.recentTurnsText || 'none'}
    </recent_turns>
  </conversation_history>

  <round_history>
    <compactions>
    ${renderBrainCompactBlocks(input.state.memory.taskRun.compactions)}
    </compactions>

    <rounds>
    ${renderBrainRoundSection(getRecentHistoryRounds(input.state))}
    </rounds>
  </round_history>

  <task_progress>
  ${renderTaskProgress({
    state: input.state,
    latestRound,
    latestExecutionText: renderBrainRoundExecutionOnly(latestRound),
    mode: 'brain_prompt'
  })}
  </task_progress>

  <decision_hint>
${input.state.execution.pendingDecisionHint ? renderDecisionHintForBrain(input.state.execution.pendingDecisionHint) : 'none'}
  </decision_hint>
</user_context>
`.trim()

  return {
    system,
    user
  }
}
