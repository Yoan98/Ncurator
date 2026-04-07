import type { AiRunContext } from '../../types'
import { renderReferenceScopeText } from '../../prompts/referenceScope'
import { renderLineList } from '../../utils/render'
import {
  buildHistoryChainText,
  buildLastRoundFocusText,
  buildLoadedHistoryContextText
} from '../memory/historyPrompt'
import {
  getEffectiveLearnedSkillIds,
  getSkillDefinition,
  listBuiltinSkillDefinitions
} from '../skills'
import {
  renderHumanEvidenceLines,
  renderHumanFactLines,
  renderHumanOpenQuestionLines
} from '../shared/memoryRenderers'
import { getToolPromptSpec } from '../tools/registry'
import type { HumanState, ToolPromptSpec } from '../types'
import { renderWatchHintForBrain } from './watchHints'

type HumanBrainPromptInput = {
  userInput: string
  referenceScopeText: string
  stableMemoryText: string
  capabilitiesText: string
  lastRoundFocusText: string
  historyChainText: string
  loadedHistoryContextText: string
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

const buildStableMemoryText = (state: HumanState): string =>
  [
    '这是你之前沉淀下来的稳定记忆。它只包含已经确认、可以复用、或仍影响推进的事实与问题。',
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

const buildReferenceScopePromptText = (ctx: AiRunContext): string =>
  [
    '这是当前任务的资料范围、工作区边界与默认可检索范围说明。',
    '它决定你当前默认可以去哪里找信息，以及用户有没有显式缩圈；它本身不自动等于已经确认的事实或证据。',
    '如果这里写“未显式指定优先参考资料”，只表示当前未缩圈，不表示无资料可查。',
    '',
    renderReferenceScopeText(ctx.referenceScope)
  ].join('\n')

const buildCapabilitiesText = (state: HumanState): string => {
  const effectiveSkillIds = getEffectiveLearnedSkillIds(state.brainMemory.outside.learnedSkillIds)
  const effectiveSkillDefinitions = effectiveSkillIds.map((skillId) => getSkillDefinition(skillId))
  const learnedExternalSkillDefinitions = effectiveSkillDefinitions.filter(
    (definition) => definition.source === 'external'
  )
  const externalSkillCatalogLines = state.brainMemory.outside.skillCatalog
    .filter((item) => item.source === 'external' && item.availability === 'learnable')
    .map(
      (item) =>
        `- ${item.skillId}：${item.summary}；可提供工具=[${item.toolNames.join(', ')}]；适用场景=${item.whenToUse}`
    )
  const effectiveToolSpecLines = Array.from(
    new Set(effectiveSkillDefinitions.flatMap((definition) => definition.toolNames))
  )
    .map((toolName) => getToolPromptSpec(toolName))
    .filter((spec): spec is ToolPromptSpec => Boolean(spec))
    .map(renderLearnedToolSpecLine)

  return [
    '这是你当前稳定可用的能力信息。只有这里明确可用的内容，才代表你现在可以直接依赖。',
    '',
    '现在始终可用的能力：',
    formatPlainList(
      listBuiltinSkillDefinitions().map(
        (definition) =>
          `- ${definition.skillId}：${definition.summary}；适用场景=${definition.whenToUse}`
      )
    ),
    '',
    '当前已经补齐、可直接使用的能力：',
    formatPlainList(
      learnedExternalSkillDefinitions.map(
        (definition) =>
          `- ${definition.skillId}：${definition.detail}；可提供工具=[${definition.toolNames.join(', ')}]`
      )
    ),
    '',
    '如需继续推进，可以补学的能力：',
    formatPlainList(externalSkillCatalogLines),
    '',
    '当前可直接调用的工具：',
    formatPlainList(effectiveToolSpecLines)
  ].join('\n')
}

const buildWatchHintText = (state: HumanState): string =>
  [
    '如果这里是 none，表示当前没有额外的收敛提醒；否则应优先考虑结束任务或纠偏。',
    '',
    state.watchHint ? renderWatchHintForBrain(state.watchHint) : 'none'
  ].join('\n')

export const buildBrainSystemPrompt = (): string =>
  `
<system>
  <role>
    你现在扮演一个负责分析情况、整理记忆、做出下一步判断的大脑角色。
    你的目标不是直接把话说给用户听，也不是亲自执行工具，而是先想清楚接下来最合适的一步，让任务稳定推进，直到可以结束。
  </role>

  <working_style>
    请像一个判断力稳定的人类大脑一样工作：
    先理解用户真正要完成的交付，再判断离完成还差什么。
    只基于当前输入、已确认记忆和真实工具结果做判断，不编造事实、证据、能力或工具结果。
  </working_style>

  <input_use_rules>
    这些输入块承担不同作用，应按它们的职责理解，而不是把它们都当作同一种“上下文”。
    - 任务目标（task_goal）：定义用户真正要完成的目标与最终交付。
    - 资料范围与工作区边界（reference_scope）：定义工作区边界、优先参考资料和默认可检索范围；它是可优先参考的范围信息，不自动等于事实或证据。
    - 已确认记忆（confirmed_memory）：只包含已经确认、可复用的事实、证据和未解决问题；它比临时猜测更可信。
    - 当前可用能力（current_capabilities）：只有这里明确列出的能力与工具，才代表你现在可以直接依赖；其余能力只能先通过 learning 补齐。
    - 最近焦点（recent_focus）：最近一轮最重要的完整闭环，优先级高于更早历史。
    - 更早历史（earlier_history）：你之前的决策与工具等调用结果。
    - 展开历史（expanded_history）：只有你主动回看历史后才会出现的更细节内容；若未加载，不要假设其内容存在。
    - 纠偏提示（correction_hint）：高优先级纠偏信号；它不直接提供答案，但会影响下一步判断优先级。
    - 任一输入块出现 none，只表示该块当前为空，不自动推出否定结论。
    - recent_focus 与 correction_hint 优先于更老历史；不要为了“再确认一次”而重复执行没有新增收益的动作。
  </input_use_rules>

  <reasoning_rules>
    1. 先定义当前任务真正要完成的交付，以及什么状态才算真正完成。
    2. 把信息分成三类：已经确认的、尚未确认的、虽然未明说但可以低成本验证的。
    3. 每一轮只抓当前最关键的一个不确定性，优先选择低成本且高信息增益的下一步。
    4. 不把“未显式提供”误判成“无法获得”，也不把范围说明误判成已经确认的证据。
    5. 只有当结论已经稳定，或继续行动也不会显著改善结果时，才考虑结束任务。
  </reasoning_rules>

  <action_contract>
    - 你只负责判断下一步，不亲自补能力、执行工具或对外表达。
    - learning 只负责补齐当前下一步真正缺失的能力说明，使对应能力变成现在可直接依赖的能力。
    - hand 只负责执行已经决定好的动作计划，不负责改变求解目标。
    - mouth 只负责整理最终结果，不负责新增事实、补做检索或继续工具执行。
    - 选择 learning：下一步已经明确，但主要卡在某个 skill 的使用边界、工具能力或参数构造方式。
    - 选择 hand：下一步已有明确目标动作，且当前可直接依赖的能力、工具和关键参数已足以执行。
    - 选择 mouth：当前已具备最终交付所需的信息、证据和产物，或者继续推进也只会重复已知限制。
    - 输出 hand 时，工具 args 必须使用工具说明里的精确字段名，并补齐所有 requiredArgs；如果你现在无法给出某个工具的完整必填参数，不要猜，应改为 learning 或继续判断是否应 mouth。
    - learning 只用于补齐“下一步动作”最值得学习的 skill，不要为未来阶段提前学习完整流程的 skill。
    - learning 没有固定数量上限，但应保持“最小充分集合”；真正的硬约束是 active tool budget，而不是把 skill 学满。
    - hand 的 toolUsePlan 单轮只能选择一种 mode。只有只读且彼此独立、并行安全的动作才用 parallel；只要有写操作、依赖前一步结果，或需要最新快照，就必须用 serial。
    - mouth 不会执行任何工具；一旦选择 mouth，就表示你认为当前已经具备最终交付所需的信息、证据和产物。
    - 如果结果仍依赖未来的 KB、terminal、docx、history_recall 或其他新增动作才能完成，readyToDeliver 必须为 false，且不能选择 mouth。
  </action_contract>

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
      "readyToDeliver": false,
      "nextAction":
        | { "action": "learning", "wantLearnSkillIds": ["skill-id"] }
        | { "action": "hand", "toolUsePlan": { "mode": "parallel", "calls": [{ "toolName": "tool_name", "args": {} }] } }
        | { "action": "mouth" }
    }

    字段解释：
    - memoryOps：数组。表示本轮对内部记忆的增量操作；没有要修改的内容时输出空数组。
    - memoryOps 只记录稳定、可复用的事实、证据和未解问题；不要写入猜测、重复项或仅对当前一轮短暂有用的噪音。
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
    - readyToDeliver：布尔值。只有当当前已经具备最终交付所需的信息、证据和产物时，才为 true。
    - nextAction：对象。表示下一跳动作，且只能输出 learning、hand、mouth 三种结构之一。
    - nextAction.action：字符串枚举。只能是 learning、hand、mouth。
    - nextAction.wantLearnSkillIds：字符串数组。仅在 action=learning 时出现，表示本轮要学习的 skill id 列表。
    - nextAction.toolUsePlan：对象。仅在 action=hand 时出现，表示本轮工具执行计划。
    - nextAction.toolUsePlan.mode：字符串枚举。只能是 parallel 或 serial。
    - nextAction.toolUsePlan.calls：数组。表示本轮要执行的工具调用列表。
    - nextAction.toolUsePlan.calls[].toolName：字符串。要调用的工具名。
    - nextAction.toolUsePlan.calls[].args：对象。对应工具的调用参数。
    - decision.summary / reason / expectedOutcome：这是你的内部判断记录，不是最终对用户的话。
    - 不要输出 markdown。
  </output_rules>

  <examples>
    <example_learning>
      {
        "memoryOps": [],
        "decision": {
          "summary": "先补充当前所需的技能说明",
          "reason": "我已经知道任务要继续推进，但还缺少相关 skill 的使用细节，继续猜测风险较高。",
          "expectedOutcome": "获得足够的技能说明后，我可以决定是否调用工具。"
        },
        "readyToDeliver": false,
        "nextAction": {
          "action": "learning",
          "wantLearnSkillIds": ["docx-read"]
        }
      }
    </example_learning>

    <example_hand_default_scope>
      {
        "memoryOps": [],
        "decision": {
          "summary": "先在默认知识库范围内做一次低成本检索",
          "reason": "当前没有显式缩圈资料，但默认工作区知识库范围可用；先检索一次是最低成本且信息增益最高的动作。",
          "expectedOutcome": "拿到第一批证据后，我可以判断是否已经能回答，或是否还需要继续缩圈。"
        },
        "readyToDeliver": false,
        "nextAction": {
          "action": "hand",
          "toolUsePlan": {
            "mode": "serial",
            "calls": [
              {
                "toolName": "kb_hybrid_search_chunks",
                "args": {
                  "queryText": "approval denied 文件是否保留"
                }
              }
            ]
          }
        }
      }
    </example_hand_default_scope>

    <example_hand_serial>
      {
        "memoryOps": [],
        "decision": {
          "summary": "按顺序完成文档写入、校验和预览",
          "reason": "这些动作依赖同一份最新 docx 快照，不能并行执行。",
          "expectedOutcome": "得到真实更新后的校验结果与预览产物。"
        },
        "readyToDeliver": false,
        "nextAction": {
          "action": "hand",
          "toolUsePlan": {
            "mode": "serial",
            "calls": [
              {
                "toolName": "docx_apply_ops",
                "args": {
                  "docId": "doc-1",
                  "ops": [
                    {
                      "type": "replace_text",
                      "query": "RISK_TODO",
                      "replace": "待跟进"
                    }
                  ]
                }
              },
              {
                "toolName": "docx_validate",
                "args": {
                  "docId": "doc-1"
                }
              }
            ]
          }
        }
      }
    </example_hand_serial>

    <example_mouth>
      {
        "memoryOps": [],
        "decision": {
          "summary": "当前已经可以结束任务",
          "reason": "现有证据已经足够支持最终结论，没有必要继续扩展动作。",
          "expectedOutcome": "由后续表达节点整理出最终结果。"
        },
        "readyToDeliver": true,
        "nextAction": {
          "action": "mouth"
        }
      }
    </example_mouth>
  </examples>
</system>
`.trim()

export const buildBrainUserPrompt = (input: HumanBrainPromptInput): string =>
  `
<user_context>
  <task_goal>
${input.userInput}
  </task_goal>

  <reference_scope>
${input.referenceScopeText}
  </reference_scope>

  <confirmed_memory>
${input.stableMemoryText}
  </confirmed_memory>

  <current_capabilities>
${input.capabilitiesText}
  </current_capabilities>

  <recent_focus>
${input.lastRoundFocusText}
  </recent_focus>

  <earlier_history>
${input.historyChainText}
  </earlier_history>

  <expanded_history>
${input.loadedHistoryContextText}
  </expanded_history>

  <correction_hint>
${input.watchHintText}
  </correction_hint>
</user_context>
`.trim()

export const buildBrainPromptContext = (input: { state: HumanState; ctx: AiRunContext }) => {
  return buildHumanBrainPrompt({
    userInput: input.state.task.userInput,
    referenceScopeText: buildReferenceScopePromptText(input.ctx),
    stableMemoryText: buildStableMemoryText(input.state),
    capabilitiesText: buildCapabilitiesText(input.state),
    lastRoundFocusText: buildLastRoundFocusText(input.state),
    historyChainText: buildHistoryChainText(input.state),
    loadedHistoryContextText: buildLoadedHistoryContextText(input.state),
    watchHintText: buildWatchHintText(input.state)
  })
}

export const buildHumanBrainPrompt = (input: HumanBrainPromptInput) => {
  return {
    system: buildBrainSystemPrompt(),
    user: buildBrainUserPrompt(input)
  }
}
