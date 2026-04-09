import { getLoadedHistoryContext } from '../memory/roundHistory'
import { renderUnifiedHistoryText } from '../shared/historyRenderers'
import { renderHumanStableNotes } from '../shared/memoryRenderers'
import { renderHumanArtifactLines } from '../shared/runtimeRenderers'
import type { HumanState } from '../types'

const buildFinalDecisionText = (state: HumanState): string =>
  state.execution.currentDecision
    ? `最终决定（readyToDeliver=${String(state.execution.currentDecision.readyToDeliver)}）：“${state.execution.currentDecision.decision.summary}”；原因：${state.execution.currentDecision.decision.reason}；预期结果：${state.execution.currentDecision.decision.expectedOutcome}`
    : 'none'

export const buildMouthPrompt = (input: { state: HumanState }) => {
  const system = `
<system>
  <role>
    你现在负责根据已有事实回答用户这次任务。
    你的目标不是复述内部过程，而是直接完成 task_goal 里用户真正要的回复。
  </role>

  <available_information>
    - task_goal：用户最初要你完成什么，以及用户显式要求你回答哪些点。
    - final_decision：brain 最后确认的收口方向。
    - your_notes：当前稳定事实来源。其中：
      - 已确认：当前稳定成立、可以直接告诉用户的事实。
      - 关键依据：支撑这些事实的证据、来源或命中结果。
      - 未决问题：仍会影响结论、或需要用户补充确认的点。
    - history：任务过程中真实发生过的决策、执行和结果，可用于补足 your_notes 不够具体的地方。
    - runtime_artifacts：运行中已经产生的真实产物，可按给定路径、文件名、状态和摘要引用。
  </available_information>

  <output_contract>
    - 只输出最终 markdown 正文，不要输出 JSON 或额外说明。
    - 直接回答 task_goal，优先覆盖用户显式提出的问题。
    - your_notes 优先；如果 your_notes 不够具体，可结合 history 与 runtime_artifacts 补足。
    - 只基于提供的信息回答，不要补编新的事实。
    - 标题、分节、列表都按需要使用，不固定。
    - 默认使用用户能理解的语言，不原样照抄内部标签、block id、tool 名，除非用户明确要求这些内部细节。
  </output_contract>
</system>
`.trim()

  const user = `
<user_context>
  <task_goal>
${input.state.task.userInput}
  </task_goal>

  <final_decision>
${buildFinalDecisionText(input.state)}
  </final_decision>

  <your_notes>
${renderHumanStableNotes(input.state, 'mouth_prompt')}
  </your_notes>

  <history>
${renderUnifiedHistoryText({
  roundHistory: input.state.memory.history.roundHistory,
  loadedHistoryContext: getLoadedHistoryContext(input.state)
})}
  </history>

  <runtime_artifacts>
${renderHumanArtifactLines(input.state, 'prompt')}
  </runtime_artifacts>
</user_context>
`.trim()

  return {
    system,
    user
  }
}
