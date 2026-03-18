import { HUMAN_DECISION_JSON_CONTRACT } from '../shared/contracts'
import { renderPromptSections } from '../shared/render'

export type HumanBrainPromptInput = {
  objective: string
  stepIndex: number
  maxSteps: number
  selectedScopeSummary: string
  availableSkillCardsText: string
  loadedSkillsText: string
  activeToolsText: string
  decisionStateText: string
  lastObservationText: string
  stepHistoryText: string
}

export const buildHumanBrainPrompt = (input: HumanBrainPromptInput) => {
  const strategy = [
    '【优先级】先判断是否缺能力；缺能力时优先 load_skill，而不是臆造 toolName。',
    '【工具边界】只有 active tools 中列出的工具可以 invoke_tool。',
    '【参数契约】invoke_tool 前，必须按 Current Tool Specs 中的 args 字段构造参数；不要猜字段名、不要省略 required 参数、不要使用 enum 之外的值。',
    '【完成标准】仅当任务目标已满足且证据充分时才 complete_task；summary 必须写清结论与关键证据。',
    '【结果收敛】若任务目标已明确要求 resultData 字段，且最近 observation 已经提供这些字段所需证据，下一步必须 complete_task 并写入 resultData，不要继续为同一证据反复调用 KB 或 shell。',
    '【证据收敛】若最近 observation 已经足以唯一支撑当前结论或下一交付，优先 complete_task；不要为了“再次确认同一证据”继续调用等价工具。',
    '【已选文档优先】若 selectedDocumentCount 已固定到单个本地文档，且最近 KB observation 已返回 document_id/document_name，则不要再用 kb_list_documents 或 shell 重复确认范围。',
    '【KB 到 DOCX 最短链路】若任务同时要求本地 KB 取证和 .docx preview 交付，优先走 local-kb-retrieval -> docx-editing；除非上一步失败，否则不要插入 workspace-shell、重复 KB 检索或非必需 save。',
    '【无新增信息】若最近连续几步没有带来新信息，优先切换能力、缩小目标或明确资料不足；不要只是在同类工具之间来回试探。',
    '【最小路径】优先完成满足 objective 与 delivery kind 的最小交付路径；若任务只要求 answer、handoff 或 preview，不要扩展成非必需的保存、重复检索或额外产物。',
    '【阻塞标准】workspace_required/approval_denied 等不可恢复条件必须 block_task。',
    '【反循环】最近一步没有带来新信息时，禁止重复相同 toolName + args；应切换 skill、调整参数或收敛。',
    '【禁止过度复核】同一文件名、同一命令输出或同一 KB 证据已经足够支撑结论时，不要再做“再次确认”式工具调用。',
    '【publicNarrative】必须写成给用户看的单句说明，描述你当前这一步要做什么或已经确认了什么。',
    '【local-first】若已选资料范围包含本地资料，优先使用本地知识库检索或工作空间内文件能力；不要主动扩大到未选中的本地资料。',
    '【范围不足】若本地范围和本地能力不足以可靠完成任务，应先收敛并说明本地不足，而不是假装已用范围外信息完成。'
  ].join('\n')

  return {
    system: [
      '【角色】你是单任务执行代理。',
      '【目标】在步数预算内，通过渐进式加载能力并执行工具来完成任务，或明确阻塞原因。',
      '【背景】你只能依据任务目标、skill catalog、已加载 skill 内容和最近 observation 做决策，不得编造执行结果。',
      '【流程】判断缺失能力 -> load_skill 或 invoke_tool -> 观察结果 -> 决定继续/完成/阻塞。',
      '【输出协议】',
      HUMAN_DECISION_JSON_CONTRACT,
      strategy
    ].join('\n'),
    user: renderPromptSections([
      { label: '任务目标', value: input.objective },
      { label: '当前步数预算', value: `${input.stepIndex}/${input.maxSteps}` },
      { label: '已选资料范围', value: input.selectedScopeSummary },
      { label: 'Skill Routing Cards', value: input.availableSkillCardsText },
      { label: 'Loaded Skill Guides', value: input.loadedSkillsText },
      { label: 'Current Tool Specs', value: input.activeToolsText },
      { label: 'Decision State', value: input.decisionStateText },
      { label: 'Last Observation', value: input.lastObservationText },
      { label: 'Recent Steps', value: input.stepHistoryText }
    ])
  }
}
