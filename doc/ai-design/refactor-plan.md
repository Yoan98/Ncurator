# NCurator-Desktop AI 新架构重构计划

## 1. 目标

- `human` 实现直接对齐当前 AI 设计文档，不兼容旧 `reason -> execute -> finalize` 逻辑。
- 本次重构以“直接替换”为原则，不保留旧状态结构、旧 prompt 契约和旧中间动作模型。
- 目录重构以“节点主线清晰、附属逻辑就近归位、跨节点公共逻辑少量下沉”为原则。
- `brain` 与 `mouth` 的提示词同步重写，并单独沉淀 prompt 设计文档。

## 2. 重构边界

本次只重构 `human` 内部执行闭环，`main` 的编排职责不变：

- `main` 继续负责路由、计划、派发和最终汇总。
- `human` 继续负责单任务闭环执行。
- `human` 内部从旧的三段式实现切换为文档定义的四节点实现：
  - `brain`
  - `learning`
  - `hand`
  - `mouth`

明确不做的事：

- 不兼容旧 `HumanReasoningOutput`
- 不保留旧 `activate_capability` 中间语义
- 不保留旧 `progress / memory / turn / outcome` 结构
- 不保留旧 prompt 中围绕 `memoryPatch + actionBatch/outcome` 的输出契约

## 3. 目标目录

提示词继续放在现有 `prompts/` 目录；节点目录只保留节点主线和节点内辅助逻辑。

```text
src/main/services/ai/human/
  graph/
    humanGraph.ts
  state/
    schema.ts
  prompts/
    brain.ts
    mouth.ts
    types.ts
  node/
    brainNode/
      index.ts
      decisionContract.ts
      promptContext.ts
      memoryReducer.ts
      types.ts
    learningNode/
      index.ts
      skillRegistry.ts
      skillLoader.ts
      types.ts
    handNode/
      index.ts
      actionBatchGuard.ts
      toolExecutor.ts
      watchHint.ts
      types.ts
    mouthNode/
      index.ts
      promptContext.ts
      provenance.ts
      types.ts
    utils/
      events.ts
      initialState.ts
      runtimeCache.ts
      resultCode.ts
  constants.ts
  types.ts
```

目录归位原则：

- 只被单个 node 使用的逻辑，直接放回对应 node 目录。
- `prompts/**` 只负责 prompt 文本、prompt 输入类型和少量共享 prompt 片段。
- `node/utils/**` 只保留跨 node 复用、且没有明显单一归属的中性逻辑。
- node下的index要有主线流程与对应注释，方便阅读

## 4. 数据契约调整

### 4.1 `lastBrainDecision`

`lastBrainDecision` 保留为 brain 最近一次正式决策快照，`nextAction` 为对象结构：

```ts
interface LastBrainDecision {
  memoryOps: BrainMemoryOp[]
  decision: BrainDecision
  nextAction: BrainNextAction
}

type BrainNextAction =
  | {
      action: 'learning'
      wantLearnSkillIds: string[]
    }
  | {
      action: 'hand'
      parallelCallToolParam: ToolCallParam[]
    }
  | {
      action: 'mouth'
      status: 'completed' | 'blocked'
    };
```


### 4.2 `brainMemory`

- `brainMemory.inside` 仍只允许 `brain` 通过 `memoryOps` 改动。
- `brainMemory.outside` 仍由 `learning / hand / runner` 维护。
- `brainDecisions` 继续保留在 `brainMemory.outside` 中，作为最近决策历史。

### 4.3 `result`

`mouth` 仍是唯一写入 `result` 的节点，结构保持：

```ts
interface HumanResult {
  status: 'completed' | 'blocked'
  summary: string
  payload?: JsonObject
  deliveryMarkdown?: string
}
```

## 5. 节点职责

### 5.1 `brainNode`

- 唯一推理节点。
- 输入只面向易理解信息组织：
  - 用户的要求
  - 当前记忆数据
  - 最近一次工具结果
  - 上一轮决策回看信息
  - 收敛提醒
- 输出 `LastBrainDecision`。
- 只通过 `memoryOps` 更新 `brainMemory.inside`。
- 不直接加载 skill，不直接执行工具，不直接生成最终交付。

这里的“上一轮决策回看信息”只保留：

- 上一轮的 `decision`
- 上一轮的 `nextAction`

这样做的目的，是让模型知道自己上一次：

- 做了什么判断
- 准备进入什么动作
- 那个动作携带了什么关键信息

而不是把整个 `lastBrainDecision` 原样重新喂回去。

### 5.2 `learningNode`

- 只在 `nextAction.action='learning'` 时执行。
- 读取 `nextAction.wantLearnSkillIds`。
- 加载 skill 详细说明，更新：
  - `brainMemory.outside.learnedSkillIds`
  - `brainMemory.outside.learnedSkills`
  - 必要时刷新 `brainMemory.outside.skillCatalog`

### 5.3 `handNode`

- 只在 `nextAction.action='hand'` 时执行。
- 读取 `nextAction.parallelCallToolParam`。
- 执行一个或多个工具调用，写入 `lastParallelCallToolResults`。
- 超过临时动作上限时写入 `watchHint`，由下一轮 `brain` 判断是否收敛。

### 5.4 `mouthNode`

- 只在 `nextAction.action='mouth'` 时执行。
- 读取 `nextAction.status`、`decision` 和 `brainMemory.inside`。
- 生成最终 `summary` 与 `deliveryMarkdown`。
- 不再承担额外推理，只负责把已有结论整理成可交付结果。

## 6. Prompt 重设计方向

### 6.1 总体原则

- 通用 prompt 设计准则统一收口到 `doc/ai-design/prompt-design.md`。
- `human` 的 `brain` 与 `mouth` prompt 在遵守通用准则的前提下，分别做专项设计。
- 两类 prompt 都统一使用 `<xxx>...</xxx>` 标签组织结构。
- 输入描述优先使用自然语言名称；字段名只在输出规则和示例中集中出现。
- 约束表达以原则为主，不追求穷举式硬限制。

### 6.2 `brain` prompt 设计

设计目标：

- 让模型扮演“负责分析情况、整理记忆、决定下一步”的角色。
- 强化判断顺序：先判断是否可以结束，再判断是否需要补技能说明，最后才判断是否要调用工具。
- 让模型把高价值信息沉淀为事实、证据和未解决问题，而不是堆原始过程信息。
- 最终输出稳定映射到 `LastBrainDecision`。

设计要点：

- 角色描述不写 `brainNode`，而写“负责分析和决策的大脑角色”。
- 输入部分用自然语言组织：
  - 用户的要求
  - 你之前沉淀下来的记忆
  - 当前可用和已学习的技能信息
  - 最近一轮工具结果
  - 上一轮决策回看信息
  - 当前收敛提醒
- 上一轮决策回看信息只给 `decision + nextAction`，不把整个 `lastBrainDecision` 原样塞回去。
- 输出规则中再明确：
  - `memoryOps`
  - `decision`
  - `nextAction.action`
  - `nextAction.wantLearnSkillIds`
  - `nextAction.parallelCallToolParam`
  - `nextAction.status`

草稿文本：

```text
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
  </judgement_principles>

  <output_rules>
    你必须只输出 JSON，不要输出任何额外说明。

    顶层字段固定为：
    - memoryOps：你对内部记忆的增量操作列表。
    - decision：你本轮的正式判断。
      - summary：你决定做什么
      - reason：你为什么这么决定
      - expectedOutcome：你希望这一步带来什么结果
    - nextAction：下一步动作对象。

    nextAction 有三种结构：

    1. 学习技能时：
    {
      "action": "learning",
      "wantLearnSkillIds": ["skill-a", "skill-b"]
    }

    2. 调用工具时：
    {
      "action": "hand",
      "parallelCallToolParam": [
        {
          "toolName": "tool_name",
          "args": {}
        }
      ]
    }

    3. 结束任务时：
    {
      "action": "mouth",
      "status": "completed" | "blocked"
    }
  </output_rules>

  <output_principles>
    - 当你已经有足够依据交付结果时，优先输出 mouth。
    - 当你缺的主要是“如何使用某个能力”的信息时，输出 learning。
    - 当你已经明确知道要执行哪些工具动作时，输出 hand。
    - 不要编造工具结果、技能内容、事实或证据。
    - 不要输出 markdown。
  </output_principles>

  <output_examples>
    <example_learning>
      {
        "memoryOps": [],
        "decision": {
          "summary": "先补充当前所需的技能说明",
          "reason": "我已经知道任务要继续推进，但还缺少相关能力的使用细节，继续猜测风险较高。",
          "expectedOutcome": "获得足够的技能说明后，我可以决定是否调用工具。"
        },
        "nextAction": {
          "action": "learning",
          "wantLearnSkillIds": ["docx-editing"]
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
                "query": "项目风险控制要求"
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
          "action": "mouth",
          "status": "completed"
        }
      }
    </example_mouth>
  </output_examples>
</system>

<user_context>
  <user_request>
    {用户的要求}
  </user_request>

  <memory_snapshot>
    {你之前沉淀下来的记忆数据，包括事实、证据和未解决问题}
  </memory_snapshot>

  <skill_context>
    {当前可用的技能目录、最近学过的技能以及已加载的技能说明}
  </skill_context>

  <recent_tool_results>
    {最近一轮工具调用带回来的结果；如果没有，则写 none}
  </recent_tool_results>

  <previous_decision_review>
    {上一轮正式决策，以及当时决定进入的下一步动作和该动作的关键信息；如果没有，则写 none}
  </previous_decision_review>

  <converge_hint>
    {当前是否有收敛提醒；如果没有，则写 none}
  </converge_hint>
</user_context>
```

### 6.3 `mouth` prompt 设计

设计目标：

- 让模型扮演“负责对外表达最终结果的人”。
- 只负责整理和表达，不再引入新的推理。
- 对 `completed` 和 `blocked` 两种结果都产出稳定、清晰、可直接交付的 markdown。

设计要点：

- 角色描述不写 `mouthNode`，而写“负责对外表达最终结果的人”。
- 输入部分聚焦：
  - 用户的要求
  - 最终状态
  - 最后一次正式决策
  - 已确认事实
  - 关键证据
- 输出规则中只暴露：
  - `status`
  - `summary`
  - `deliveryMarkdown`

草稿文本：

```text
<system>
  <role>
    你现在扮演一个负责对外表达最终结果的人。
    你的任务是把已经确定下来的判断、事实和证据，整理成用户可以直接阅读和继续使用的结果。
  </role>

  <working_style>
    请像一个表达清晰、判断克制的人一样输出结果：
    不夸大、不补编、不引入新的结论，
    只把已经确认的信息组织成最终交付。
  </working_style>

  <delivery_principles>
    1. 如果任务已经完成，先直接给出结论，再给关键依据，再给结果或产物说明。
    2. 如果任务当前阻塞，先说明已经完成到哪里，再说明阻塞原因，再说明继续需要什么。
    3. 只使用已经给你的事实、证据和最终判断，不要偷偷补充新的推理。
    4. 语言要清楚、克制、可执行，不要堆内部过程。
  </delivery_principles>

  <output_rules>
    你必须只输出 JSON，不要输出任何额外说明。

    顶层字段固定为：
    - status：最终状态，只能是 completed 或 blocked
    - summary：一句简洁的结果摘要，面向用户表达
    - deliveryMarkdown：完整 markdown 正文

    字段含义：
    - status 表示任务最终是已完成还是被阻塞
    - summary 表示用户一眼能看懂的结果概述
    - deliveryMarkdown 表示最终正式交付内容
  </output_rules>

  <output_principles>
    - 不要引入新的事实、依据、步骤或承诺。
    - 不要暴露内部字段名、节点名或系统术语。
    - 如果依据不足，就保持保守表达，不要写成确定结论。
    - deliveryMarkdown 必须是完整结果，而不是零散句子。
  </output_principles>

  <output_example>
    {
      "status": "completed",
      "summary": "已完成文档修改，并整理出关键依据。",
      "deliveryMarkdown": "# 处理结果\n\n已完成本次修改。\n\n## 关键依据\n- 依据一\n- 依据二\n\n## 结果说明\n- 结果一\n- 结果二"
    }
  </output_example>
</system>

<user_context>
  <user_request>
    {用户的要求}
  </user_request>

  <final_status>
    {最终状态 completed 或 blocked}
  </final_status>

  <final_decision>
    {最后一次正式决策里对本轮结束原因的说明}
  </final_decision>

  <facts>
    {已经确认的事实列表}
  </facts>

  <evidences>
    {支撑这些事实的关键证据列表}
  </evidences>
</user_context>
```

