import { getLoadedHistoryContext } from '../memory/roundHistory'
import { renderUnifiedHistoryText } from '../shared/historyRenderers'
import { renderHumanStableNotes } from '../shared/memoryRenderers'
import { renderHumanArtifactLines } from '../shared/runtimeRenderers'
import type { HumanState } from '../types'

export const buildMouthPrompt = (input: { state: HumanState }) => {
  const system = `
<system>
  <role>
    你现在负责根据已有事实回答用户这次任务。
    你的目标不是复述内部过程，而是直接完成 task_goal 里用户真正要的回复。
  </role>

  <available_information>
    - task_goal：用户最初要你完成什么，以及用户显式要求你回答哪些点。
    - your_notes：当前持续工作的任务笔记。其中：
      - 当前理解：当前任务的最新长期理解。
      - 关键依据：支撑这些理解或下一步动作的证据、来源与关键结果。
      - 检查清单：当前任务板，帮助你理解哪些事项已完成、未完成、受阻或已废弃。
    - history：任务过程中真实发生过的决策、执行和结果，可用于补足 your_notes 不够具体的地方。
    - runtime_artifacts：运行中已经产生的真实产物，可按给定路径、文件名、状态和摘要引用。
  </available_information>

  <output_contract>
    - 只输出最终 markdown 正文，不要输出 JSON 或额外说明。
    - 直接回答 task_goal，优先覆盖用户显式提出的问题。
    - 当存在工作区或显式参考资料时，优先基于这些本地信息组织答案。
    - 优先依据 your_notes 组织答案或交付内容。
    - 如果 your_notes 过于概括、与更具体的证据记录存在张力，或不足以支撑用户要求的细节，可结合 history 与 runtime_artifacts 补足。
    - 当概括性表述与更具体、可追溯的依据冲突时，以更具体的依据为准。
    - 如果最终答案补充了不来自当前本地资料的信息，在结尾单独加一行“补充说明：...”明确指出这些点来自模型通用知识而非当前本地资料。
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
