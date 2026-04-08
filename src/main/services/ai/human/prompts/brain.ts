import type { AiRunContext } from '../../types'
import { renderReferenceScopeText } from '../../prompts/referenceScope'
import {
  getHistoryChainRounds,
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
import { getToolPromptSpec } from '../tools/registry'
import type {
  HumanLoadedHistoryContext,
  HumanRoundRecord,
  HumanState,
  ToolPromptSpec
} from '../types'
import { renderWatchHintForBrain } from './watchHints'

const renderLearnedToolSpecLine = (spec: ToolPromptSpec): string => {
  const requiredArgs = spec.args
    .filter((arg) => arg.required)
    .map((arg) => `${arg.name}:${arg.type}`)
    .join(', ')
  const example = spec.examples?.[0]
    ? `示例目标=${spec.examples[0].goal}；示例参数键=[${Object.keys(spec.examples[0].args).join(', ') || 'none'}]`
    : '示例=none'

  return `- 工具 ${spec.name}：用途=${spec.purpose}；必填参数=[${requiredArgs || 'none'}]；${example}`
}

const renderStringList = (items: readonly string[]): string =>
  items.length > 0 ? items.join('、') : 'none'

const renderRoundRecord = (
  record: HumanRoundRecord,
  detail: 'focus' | 'chain' | 'loaded'
): string => {
  const nextActionText =
    record.decision.nextAction.action === 'learning'
      ? `- 你准备下一步做：准备学习 ${renderStringList(record.decision.nextAction.wantLearnSkillIds.map((skillId) => `\`${skillId}\``))}。`
      : record.decision.nextAction.action === 'hand'
        ? `- 你准备下一步做：准备进入 hand，${
            record.decision.nextAction.toolUsePlan.mode === 'parallel'
              ? `以 parallel 模式并行执行 ${renderStringList(record.decision.nextAction.toolUsePlan.calls.map((call) => `\`${call.toolName}\``))}。`
              : `以 serial 模式按顺序执行 ${renderStringList(record.decision.nextAction.toolUsePlan.calls.map((call) => `\`${call.toolName}\``))}。`
          }`
        : '- 你准备下一步做：准备进入 mouth 组织最终交付。'

  const executionText =
    record.execution.kind === 'pre_execution_blocked'
      ? '- 没有进入真实执行，系统在执行前阻断了这轮动作。'
      : record.execution.kind === 'learning'
        ? '- 进入 learning，按请求尝试补齐外置技能。'
        : record.execution.kind === 'hand'
          ? [
              `- 进入 hand，执行模式是 ${record.execution.toolUsePlan.mode}。`,
              record.execution.toolUsePlan.mode === 'parallel'
                ? `- 实际并行执行了 ${renderStringList(record.execution.toolUsePlan.calls.map((call) => `\`${call.toolName}\``))}。`
                : `- 实际按顺序执行了 ${renderStringList(record.execution.toolUsePlan.calls.map((call) => `\`${call.toolName}\``))}。`,
              detail !== 'chain'
                ? `- 本轮计划包含 ${record.execution.toolUsePlan.calls.length} 个工具调用。`
                : ''
            ]
              .filter(Boolean)
              .join('\n')
          : '- 进入 mouth，组织最终说明。'

  const resultText =
    record.execution.kind === 'pre_execution_blocked'
      ? renderWatchHintForBrain(record.execution.watchHint)
      : record.execution.kind === 'learning'
        ? [
            `- 已加载的技能：${renderStringList(record.execution.learningOutcome.loadedSkillIds.map((skillId) => `\`${skillId}\``))}`,
            `- 已跳过的重复技能：${renderStringList(record.execution.learningOutcome.skippedDuplicateSkillIds.map((skillId) => `\`${skillId}\``))}`,
            `- 未识别的技能：${renderStringList(record.execution.learningOutcome.skippedUnknownSkillIds.map((skillId) => `\`${skillId}\``))}`,
            `- 当前 active tool 数：${String(record.execution.learningOutcome.activeToolCount)}`,
            record.execution.watchHint
              ? `- 收敛提示：${renderWatchHintForBrain(record.execution.watchHint)}`
              : ''
          ]
            .filter(Boolean)
            .join('\n')
        : record.execution.kind === 'hand'
          ? [
              ...record.execution.toolResults.map((result) =>
                [
                  `- \`${result.toolName}\`：${result.summary}`,
                  result.dataPreview ? `结果：${result.dataPreview}` : '',
                  result.diagnosticText ? `诊断：${result.diagnosticText}` : ''
                ]
                  .filter(Boolean)
                  .join('；')
              ),
              record.execution.artifactRefs && record.execution.artifactRefs.length > 0
                ? `- 产物：${renderStringList(
                    record.execution.artifactRefs.map((artifact) =>
                      artifact.kind === 'file'
                        ? `\`${artifact.fileName}\``
                        : `draft review ${artifact.review.reviewId}`
                    )
                  )}`
                : '',
              record.execution.watchHint
                ? `- 收敛提示：${renderWatchHintForBrain(record.execution.watchHint)}`
                : ''
            ]
              .filter(Boolean)
              .join('\n')
          : `${`- 输出摘要：${record.execution.summary}`}\n${
              record.execution.completed ? '- 任务已完成。' : '- 任务未完成。'
            }`

  return `
- 第 ${record.roundId} 轮

决策了什么：
- 你的判断：${record.decision.decision.summary}
- 你这样判断的原因：${record.decision.decision.reason}
- 你当时期待的结果：${record.decision.decision.expectedOutcome}
- ${record.decision.readyToDeliver ? '你当时认为已经可以交付。' : '你当时认为还不能直接交付。'}
${nextActionText}

做了什么：
${executionText}

结果是什么：
${resultText}
`.trim()
}

const renderLoadedHistoryIntro = (
  loadedHistoryContext: HumanLoadedHistoryContext | undefined
): string => {
  if (!loadedHistoryContext) {
    return '这是你主动回看后加载的历史细节。只有在明确回看历史后这里才会出现内容。'
  }

  const filters = loadedHistoryContext.filters
  return `这是你主动加载的更详细历史。只有在你明确调用 history-recall 后才会出现。
本次过滤条件：roundIds=${renderStringList((filters.roundIds || []).map(String))}；executionKinds=${renderStringList(filters.executionKinds || [])}；toolNames=${renderStringList(filters.toolNames || [])}；watchHintCodes=${renderStringList(filters.watchHintCodes || [])}；limit=${String(filters.limit || loadedHistoryContext.rounds.length)}。`
}

const renderAvailableSkillsText = (state: HumanState): string => {
  const effectiveSkillIds = getEffectiveLearnedSkillIds(state.skills.learnedSkillIds)
  const effectiveSkillDefinitions = effectiveSkillIds.map((skillId) => getSkillDefinition(skillId))
  const learnedExternalSkillDefinitions = effectiveSkillDefinitions.filter(
    (definition) => definition.source === 'external'
  )
  const learnableSkillLines = listExternalSkillDefinitions()
    .filter((definition) => !state.skills.learnedSkillIds.includes(definition.skillId))
    .map(
      (definition) =>
        `- ${definition.skillId}：${definition.summary}；可提供工具=[${definition.toolNames.join(', ')}]；适用场景=${definition.whenToUse}`
    )
  const effectiveToolSpecLines = Array.from(
    new Set(effectiveSkillDefinitions.flatMap((definition) => definition.toolNames))
  )
    .map((toolName) => getToolPromptSpec(toolName))
    .filter((spec): spec is ToolPromptSpec => Boolean(spec))
    .map(renderLearnedToolSpecLine)

  return `这是你当前已经可直接依赖、或仍可补充学习的技能与工具信息。

始终可用的技能：
${
  listBuiltinSkillDefinitions()
    .map(
      (definition) =>
        `- ${definition.skillId}：${definition.summary}；适用场景=${definition.whenToUse}`
    )
    .join('\n') || 'none'
}

已经学习的技能：
${
  learnedExternalSkillDefinitions
    .map(
      (definition) =>
        `- ${definition.skillId}：${definition.detail}；可提供工具=[${definition.toolNames.join(', ')}]`
    )
    .join('\n') || 'none'
}

仍可补充学习的技能：
${learnableSkillLines.join('\n') || 'none'}

当前可直接调用的工具：
${effectiveToolSpecLines.join('\n') || 'none'}`
}

export const buildBrainPrompt = (input: { state: HumanState; ctx: AiRunContext }) => {
  const lastRoundRecord = getLastRoundFocus(input.state)
  const historyChainRecords = getHistoryChainRounds(input.state)
  const loadedHistoryContext = getLoadedHistoryContext(input.state)
  const loadedHistoryRecords = loadedHistoryContext?.rounds || []

  const system = `
<system>
  <role>
    你现在扮演一个负责理解任务、审视记忆并决定下一步动作的大脑角色。
    你的职责是判断任务当前处在什么阶段，以及 learning、hand、mouth 中哪一步最合适。
  </role>

  <working_style>
    请像一个判断稳定的人类执行者一样工作：
    理解任务目标，结合当前记忆、真实执行结果和可用能力，自主判断下一步。
    不编造事实、证据、能力或工具结果。
  </working_style>

  <autonomy_principles>
    - 你会收到任务、记忆、技能、历史和提示等不同类型的信息。
    - 这些信息是提供给你判断当前局面的参考材料，不是固定流程。
    - 你需要自行判断哪些信息重要、哪些信息只是背景，以及下一步最合适的动作。
    - 除了明确写出的职责边界、输出规则和硬约束，不要把上下文说明理解成固定操作指令。
  </autonomy_principles>

  <action_boundaries>
    - 你只负责判断下一步，不亲自补能力、执行工具或直接对用户表达。
    - learning 只负责补齐当前真正缺失的技能说明。
    - hand 只负责执行已经决定好的工具计划。
    - mouth 只负责整理最终结果，不新增事实，不继续执行工具。
    - 输出 hand 时，工具 args 必须使用工具说明中的精确字段名，并补齐所有 requiredArgs。
    - 如果你现在无法给出某个工具的完整必填参数，不要猜；应改为 learning 或 mouth。
    - hand 的 toolUsePlan 单轮只能选择一种 mode。只有只读且彼此独立、并行安全的动作才用 parallel；其余情况必须用 serial。
    - 如果结果仍依赖未来的工具动作才能完成，readyToDeliver 必须为 false，且不能选择 mouth。
    - 选择 mouth 时，readyToDeliver 必须为 true。
  </action_boundaries>

  <output_rules>
    你必须只输出 JSON，不要输出任何额外说明。

    输出结构固定为：
    {
      "updatedStableMemory": {
        "confirmedFacts": "string",
        "keyEvidence": "string",
        "openQuestions": "string"
      },
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
    - updatedStableMemory：可选对象。表示本轮对任务笔记的局部更新。
    - updatedStableMemory 缺失：表示本轮不更新任务笔记。
    - updatedStableMemory 出现但某个字段缺失：表示该字段保持原值。
    - updatedStableMemory 的字段值是字符串：表示用该字符串覆盖对应字段。
    - updatedStableMemory 的字段值是空字符串：表示显式清空对应字段。
    - decision：对象。表示你本轮的正式判断。
    - readyToDeliver：布尔值。只有当当前已经具备最终交付所需的信息、证据和产物时，才为 true。
    - nextAction：对象。表示下一跳动作，且只能输出 learning、hand、mouth 三种结构之一。
    - 不要输出 markdown。
  </output_rules>

  <examples>
    <example_keep_notes>
      {
        "decision": {
          "summary": "先学习当前缺失的技能",
          "reason": "下一步已经明确，但仍缺少相关技能说明。",
          "expectedOutcome": "补齐技能说明后可以决定是否调用工具。"
        },
        "readyToDeliver": false,
        "nextAction": {
          "action": "learning",
          "wantLearnSkillIds": ["docx-read"]
        }
      }
    </example_keep_notes>

    <example_partial_notes_update>
      {
        "updatedStableMemory": {
          "keyEvidence": "- kb_hybrid_search_chunks 命中了审批驳回时保留原文件的制度说明。",
          "openQuestions": ""
        },
        "decision": {
          "summary": "证据已经足够，准备结束任务",
          "reason": "当前已拿到能直接支撑结论的依据。",
          "expectedOutcome": "由后续表达节点整理最终结果。"
        },
        "readyToDeliver": true,
        "nextAction": {
          "action": "mouth"
        }
      }
    </example_partial_notes_update>
  </examples>
</system>
`.trim()

  const user = `
<user_context>
  <task_goal>
${input.state.task.userInput}
  </task_goal>

  <reference_scope>
这是当前任务的资料范围、工作区边界与默认可检索范围说明。
它描述当前任务默认可以接触的资料范围，以及用户是否已经显式缩圈。

${renderReferenceScopeText(input.ctx.referenceScope)}
  </reference_scope>

  <memory>
    <your_notes>
这是你之前沉淀下来的任务笔记。
它记录当前任务中已经确认的事实、关键依据和仍未解决的问题。

${renderHumanStableNotes(input.state, 'brain_prompt')}
    </your_notes>

    <recent_progress>
这是最近一轮过程记录。

${lastRoundRecord ? renderRoundRecord(lastRoundRecord, 'focus') : 'none'}
    </recent_progress>

    <earlier_attempts>
这是更早几轮过程记录。

${
  historyChainRecords.length > 0
    ? historyChainRecords.map((record) => renderRoundRecord(record, 'chain')).join('\n')
    : 'none'
}
    </earlier_attempts>

    <recalled_history>
${renderLoadedHistoryIntro(loadedHistoryContext)}

${
  loadedHistoryRecords.length > 0
    ? loadedHistoryRecords.map((record) => renderRoundRecord(record, 'loaded')).join('\n')
    : 'none'
}
    </recalled_history>
  </memory>

  <available_skills>
${renderAvailableSkillsText(input.state)}
  </available_skills>

  <correction_hint>
这是当前的收敛或纠偏提示。

${input.state.execution.watchHint ? renderWatchHintForBrain(input.state.execution.watchHint) : 'none'}
  </correction_hint>
</user_context>
`.trim()

  return {
    system,
    user
  }
}
