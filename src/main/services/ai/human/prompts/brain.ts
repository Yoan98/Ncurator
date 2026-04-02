import type { AiRunContext } from '../../types'
import { renderLineList } from '../../utils/render'
import { getSkillDefinition } from '../skills'
import {
  renderHumanEvidenceLines,
  renderHumanFactLines,
  renderHumanOpenQuestionLines
} from '../shared/memoryRenderers'
import { renderHumanRecentToolResultLines } from '../shared/runtimeRenderers'
import { getToolPromptSpec } from '../tools/registry'
import type { HumanState, ToolPromptSpec } from '../types'

type HumanBrainPromptInput = {
  userInput: string
  memorySnapshotText: string
  selectedContextText: string
  skillContextText: string
  recentToolResultsText: string
  recentDecisionHistoryText: string
  watchHintText: string
}

const formatPlainList = (items: string[]): string =>
  renderLineList(items, {
    fallback: 'none',
    style: 'plain'
  })

const renderLearnedToolSpecLine = (spec: ToolPromptSpec): string => {
  const requiredArgs = spec.args
    .filter((arg) => arg.required)
    .map((arg) => `${arg.name}:${arg.type}`)
    .join(', ')
  const example = spec.examples?.[0]
    ? `示例目标=${spec.examples[0].goal}；示例参数键=[${Object.keys(spec.examples[0].args).join(', ') || 'none'}]`
    : '示例=none'

  return `- 工具 ${spec.name}：适用场景=${spec.whenToUse}；必填参数=[${requiredArgs || 'none'}]；${example}`
}

const buildMemorySnapshotText = (state: HumanState): string =>
  [
    '下面是你之前沉淀下来的记忆。这些内容代表当前已经确认、可以直接复用或仍影响推进的信息。',
    '',
    '已确认的事实：',
    renderHumanFactLines(state, 'brain_prompt'),
    '',
    '支撑这些事实的关键证据：',
    renderHumanEvidenceLines(state, 'brain_prompt'),
    '',
    '仍未解决的问题：',
    renderHumanOpenQuestionLines(state, 'brain_prompt')
  ].join('\n')

const buildSelectedContextPromptText = (ctx: AiRunContext): string =>
  [
    '下面是当前用户明确给出的参考资料上下文。后续判断、检索和文件定位都必须先对齐这段信息。',
    '',
    ctx.selectedContextText
  ].join('\n')

const buildSkillContextText = (state: HumanState): string => {
  const learnedSkillIds = state.brainMemory.outside.learnedSkillIds
  const learnedSkillDefinitions = learnedSkillIds.map((skillId) => getSkillDefinition(skillId))
  const learnedToolNames = Array.from(
    new Set(learnedSkillDefinitions.flatMap((definition) => definition.toolNames))
  )
  const learnedToolSpecLines =
    learnedToolNames.length > 0
      ? learnedToolNames
          .map((toolName) => getToolPromptSpec(toolName))
          .filter((spec): spec is ToolPromptSpec => Boolean(spec))
          .map(renderLearnedToolSpecLine)
      : ['none']

  const skillCatalogLines =
    state.brainMemory.outside.skillCatalog.length > 0
      ? state.brainMemory.outside.skillCatalog.map(
          (item) =>
            `- ${item.skillId}：${item.summary}；可提供工具=[${item.toolNames.join(', ')}]；适用场景=${item.whenToUse}`
        )
      : ['none']

  const learnedSkillIdLines =
    learnedSkillIds.length > 0 ? learnedSkillIds.map((skillId) => `- ${skillId}`) : ['none']

  const learnedSkillDetailLines =
    learnedSkillDefinitions.length > 0
      ? learnedSkillDefinitions.map((definition) => `- ${definition.skillId}：${definition.detail}`)
      : ['none']

  return [
    '下面是当前可用的技能信息。技能目录摘要只用于判断要不要学习；只有已学习 skill 的详细说明和工具要点，才代表你当前可以直接依赖的能力。',
    '',
    '当前可用技能目录摘要：',
    formatPlainList(skillCatalogLines),
    '',
    '已经学习的 skill id：',
    formatPlainList(learnedSkillIdLines),
    '',
    '已学习技能的详细说明：',
    formatPlainList(learnedSkillDetailLines),
    '',
    '已学习技能对应的工具使用要点：',
    formatPlainList(learnedToolSpecLines)
  ].join('\n')
}

const buildRecentToolResultsText = (state: HumanState): string =>
  [
    '下面是最近一轮工具调用刚带回来的新信息。请把这些结果和已有记忆一起判断，不要重复做同样的动作。',
    '',
    renderHumanRecentToolResultLines(state, 'prompt')
  ].join('\n')

const buildRecentDecisionHistoryText = (state: HumanState): string =>
  [
    '下面是最近几轮已经做过的正式判断摘要，只用于帮助你理解时间顺序并避免重复决策。',
    '',
    renderLineList(
      state.brainMemory.outside.brainDecisions.map((record, index) => {
        const ordinal = index + 1
        const action = record.nextAction.action
        const nextActionPayload =
          action === 'learning'
            ? `wantLearnSkillIds=[${record.nextAction.wantLearnSkillIds.join(',')}]`
            : action === 'hand'
              ? `parallelCallToolParam=${JSON.stringify(record.nextAction.parallelCallToolParam)}`
              : 'final_delivery=true'

        return `- 第${ordinal}轮（createdAt=${record.createdAt}）：决定“${record.decision.summary}”；原因：${record.decision.reason}；预期结果：${record.decision.expectedOutcome}；nextAction.action=${action}；nextAction数据：${nextActionPayload}`
      }),
      {
        fallback: 'none',
        style: 'plain'
      }
    )
  ].join('\n')

const buildWatchHintText = (state: HumanState): string =>
  [
    '如果这里是 none，表示当前没有额外的收敛提醒；否则应优先考虑结束任务或纠偏。',
    '',
    state.watchHint || 'none'
  ].join('\n')

export const buildBrainSystemPrompt = (): string =>
  `
<system>
  <role>
    你现在扮演一个负责分析情况、整理记忆、做出下一步判断的大脑角色。
    你的目标不是直接把话说给用户听，而是先想清楚接下来最合适的一步，让任务稳定推进，直到可以结束。
  </role>

  <working_style>
    请像一个判断力稳定的人类大脑一样工作：
    先理解用户真正要完成的事情，
    再结合你已经沉淀下来的记忆和刚获得的新信息，
    判断现在最应该做的是继续补充信息、调用工具、还是直接结束任务。
  </working_style>

  <judgement_principles>
    1. 优先判断任务是否已经可以结束。
    2. 如果当前信息不足以做决定，再判断是否缺少某个技能说明。
    3. 只有当你已经明确知道要调用什么工具、以及为什么调用时，才进入工具执行。
    4. 记忆里只保留真正会帮助后续判断的事实、证据和未解决问题，不要把低价值噪音反复堆进去。
    5. 如果最近已经拿到足够证据，就不要为了“再确认一次”而重复做同样的动作。
    6. 如果你收到收敛提醒，应优先考虑结束任务，除非只差一次非常明确且必要的动作。
    7. 输出 hand 时，工具 args 必须使用工具说明里的精确字段名，并补齐所有 requiredArgs。
    8. 如果你现在无法给出某个工具的完整必填参数，不要猜；应改为 learning 或 mouth。
    9. 如果任务是在当前用户选择的参考资料内回答、提取事实或找证据，优先考虑 KB 能力，而不是默认退回 terminal。
    10. 只有当任务确实需要访问工作区文件、执行命令或处理 docx 时，才进入 workspace 或 docx 能力。
    11. 如果最近结果明确提示 workspace_required 或 path_unavailable，不要重复同类 terminal/docx 调用。
    12. 如果最近结果提示 invalid_input 且缺字段明确，应优先修正参数或补充相关 skill，而不是切去无关能力。
    13. learning 只用于补齐“下一步动作”最值得学习的 skill，不要为未来阶段提前学习完整流程的 skill。
    14. 单次 learning 最多学习 2 个 skill；如果 1 个 skill 就足以支撑下一步，优先只学习 1 个。
  </judgement_principles>

  <output_rules>
    你必须只输出 JSON，不要输出任何额外说明。

    输出结构固定为：
    {
      "memoryOps": [],
      "decision": {
        "summary": "string",
        "reason": "string",
        "expectedOutcome": "string"
      },
      "nextAction":
        | { "action": "learning", "wantLearnSkillIds": ["skill-id"] }
        | { "action": "hand", "parallelCallToolParam": [{ "toolName": "tool_name", "args": {} }] }
        | { "action": "mouth" }
    }

    字段解释：
    - memoryOps：数组。表示本轮对内部记忆的增量操作；没有要修改的内容时输出空数组。
    - memoryOps[].op：字符串枚举。只能是 add、edit、remove。
    - memoryOps[].field：字符串枚举。只能是 facts、evidences、openQuestions。
    - memoryOps[].index：数字。仅在 edit、remove 时出现，表示要修改或删除的目标索引。
    - memoryOps[].value：仅在 add、edit 时出现。
    - memoryOps[].value（facts）：对象，结构为 { id, summary, evidenceIds }。
    - memoryOps[].value.id：字符串。该 fact 或 evidence 的稳定标识。
    - memoryOps[].value.summary：字符串。该 fact 或 evidence 的简洁摘要。
    - memoryOps[].value.evidenceIds：字符串数组。仅 facts 使用，表示支撑该 fact 的 evidence id 列表。
    - memoryOps[].value.toolName：字符串。仅 evidences 使用，表示 evidence 对应的工具名。
    - memoryOps[].value.sourceType：字符串常量。仅 evidences 使用，当前固定为 tool_result。
    - memoryOps[].value.rawRef：可选字符串。仅 evidences 使用，表示原始结果引用位置。
    - memoryOps[].value（openQuestions）：字符串。表示仍未解决的问题描述。
    - decision：对象。表示本轮正式判断。
    - decision.summary：字符串。简洁说明这轮决定做什么。
    - decision.reason：字符串。说明为什么做这个决定。
    - decision.expectedOutcome：字符串。说明期望这一步带来什么结果。
    - nextAction：对象。表示下一跳动作，且只能输出 learning、hand、mouth 三种结构之一。
    - nextAction.action：字符串枚举。只能是 learning、hand、mouth。
    - nextAction.wantLearnSkillIds：字符串数组。仅在 action=learning 时出现，表示本轮要学习的 skill id 列表；最多 2 个。
    - nextAction.parallelCallToolParam：数组。仅在 action=hand 时出现，表示本轮要执行的工具调用列表。
    - nextAction.parallelCallToolParam[].toolName：字符串。要调用的工具名。
    - nextAction.parallelCallToolParam[].args：对象。对应工具的调用参数。
  </output_rules>

  <output_principles>
    - 当你已经有足够依据交付结果时，优先输出 mouth。
    - 当外部条件不足、工具受限或结果不完整，但继续尝试的收益已经很低时，也应输出 mouth，并在 decision 中明确限制和下一步。
    - 当你缺的主要是“如何使用某个 skill”的信息时，输出 learning。
    - 当你已经明确知道要执行哪些工具动作时，输出 hand。
    - 不要编造工具结果、技能内容、事实或证据。
    - 不要输出 markdown。
  </output_principles>

  <output_examples>
    <example_memory_ops>
      {
        "memoryOps": [
          {
            "op": "add",
            "field": "evidences",
            "value": {
              "id": "evidence-kb-risk-1",
              "toolName": "kb_hybrid_search_chunks",
              "summary": "知识库结果显示项目风险控制要求包含上线前复核。",
              "sourceType": "tool_result",
              "rawRef": "tool_result#1"
            }
          },
          {
            "op": "add",
            "field": "facts",
            "value": {
              "id": "fact-risk-review-1",
              "summary": "项目上线前需要执行复核。",
              "evidenceIds": ["evidence-kb-risk-1"]
            }
          },
          {
            "op": "remove",
            "field": "openQuestions",
            "index": 0
          }
        ],
        "decision": {
          "summary": "已经得到关键依据，准备结束任务",
          "reason": "当前事实已经有足够证据支撑，不需要继续检索。",
          "expectedOutcome": "进入最终整理并输出结果。"
        },
        "nextAction": {
          "action": "mouth"
        }
      }
    </example_memory_ops>

    <example_learning>
      {
        "memoryOps": [],
        "decision": {
          "summary": "先补充当前所需的技能说明",
          "reason": "我已经知道任务要继续推进，但还缺少相关 skill 的使用细节，继续猜测风险较高。",
          "expectedOutcome": "获得足够的技能说明后，我可以决定是否调用工具。"
        },
        "nextAction": {
          "action": "learning",
          "wantLearnSkillIds": ["docx-read"]
        }
      }
    </example_learning>

    <example_hand>
      {
        "memoryOps": [],
        "decision": {
          "summary": "调用工具获取完成任务所需的直接证据",
          "reason": "当前缺的是可验证的结果，而不是额外的解释。",
          "expectedOutcome": "拿到新的工具结果后，我可以更新记忆并判断是否收敛。"
        },
        "nextAction": {
          "action": "hand",
          "parallelCallToolParam": [
            {
              "toolName": "kb_hybrid_search_chunks",
              "args": {
                "queryText": "项目风险控制要求"
              }
            }
          ]
        }
      }
    </example_hand>

    <example_mouth>
      {
        "memoryOps": [],
        "decision": {
          "summary": "当前已经可以结束任务",
          "reason": "现有证据已经足够支持最终结论，没有必要继续扩展动作。",
          "expectedOutcome": "由后续表达节点整理出最终结果。"
        },
        "nextAction": {
          "action": "mouth"
        }
      }
    </example_mouth>
  </output_examples>
</system>
`.trim()

export const buildBrainUserPrompt = (input: HumanBrainPromptInput): string =>
  `
<user_context>
  <user_request>
${input.userInput}
  </user_request>

  <memory_snapshot>
${input.memorySnapshotText}
  </memory_snapshot>

  <selected_context>
${input.selectedContextText}
  </selected_context>

  <skill_context>
${input.skillContextText}
  </skill_context>

  <recent_tool_results>
${input.recentToolResultsText}
  </recent_tool_results>

  <recent_decision_history>
${input.recentDecisionHistoryText}
  </recent_decision_history>

  <converge_hint>
${input.watchHintText}
  </converge_hint>
</user_context>
`.trim()

export const buildBrainPromptContext = (input: { state: HumanState; ctx: AiRunContext }) => {
  return buildHumanBrainPrompt({
    userInput: input.state.task.userInput,
    memorySnapshotText: buildMemorySnapshotText(input.state),
    selectedContextText: buildSelectedContextPromptText(input.ctx),
    skillContextText: buildSkillContextText(input.state),
    recentToolResultsText: buildRecentToolResultsText(input.state),
    recentDecisionHistoryText: buildRecentDecisionHistoryText(input.state),
    watchHintText: buildWatchHintText(input.state)
  })
}

export const buildHumanBrainPrompt = (input: HumanBrainPromptInput) => {
  return {
    system: buildBrainSystemPrompt(),
    user: buildBrainUserPrompt(input)
  }
}
