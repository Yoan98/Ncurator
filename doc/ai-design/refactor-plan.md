# NCurator-Desktop AI 新架构重构计划

## 0. 需要补充完善的地方

以下内容是当前重构在进入“已完成”前，仍需补充完善和对齐的部分：

- `brain` prompt 需要继续补齐，实际实现应继续向本文件第 6 章的专项 prompt 设计靠拢，而不是只停留在简化版骨架。
- `buildBrainPromptContext` 需要按需组织输入：保持“易理解信息组织”为主，但对记忆快照、最近工具结果、动作参数等强结构化输入，允许保留精简后的原始对象或 JSON 视图，需要严格参照refactor-plan的提示词。
- `mouth` 不需要读取最近决策历史；`brain` 需要读取最近决策历史摘要，这个边界必须在实现和文档中保持一致。
- `tools` 目录需要进一步从“按 skill 建目录”收敛为“按实现域归位”，skill 只保留在 `skillCatalog` / `skillRegistry` / `skillLoader` 的映射与装配层。
- 运行时结构化输出能力需要补上，逐步从仅依赖 `chatJson + JSON.parse` 的方式，收敛到 schema 驱动的 structured output 封装。
- `memoryReducer` 需要修复 `memoryOps` 的顺序敏感问题：同一轮 `memoryOps` 中，`facts[].evidenceIds` 对“本轮新增 evidence”的引用不应因为数组顺序不同而被误判为非法。

## 1. 目标

- `human` 实现直接对齐当前 AI 设计文档，不兼容旧 `reason -> execute -> finalize`、旧 `watchdog` 与旧任务结果附加字段。
- 本次重构以“直接替换”为原则，不保留旧状态结构、旧 prompt 契约和旧中间动作模型。
- `main` 的编排职责不变，但会同步收紧 `main` 与 `human` 的任务输入/结果数据契约。
- 目录重构以“节点主线清晰、附属逻辑就近归位、跨节点公共逻辑少量下沉”为原则。
- `brain` 与 `mouth` 的提示词同步重写，并单独沉淀 prompt 设计文档。

## 2. 重构边界

本次以重构 `human` 执行闭环为主，同时同步调整 `main` 与 `human` 的任务输入/结果字段；`main` 的编排职责不变：

- `main` 继续负责路由、计划、派发和最终汇总。
- `human` 继续负责单任务闭环执行。
- `human` 内部从旧的三段式实现切换为文档定义的四节点实现：
  - `brain`
  - `learning`
  - `hand`
  - `mouth`
- `main` 的计划任务与最终汇总字段同步收紧，统一以 `deliveryMarkdown` 作为正式信息载体。

明确不做的事：

- 不兼容旧 `HumanReasoningOutput`
- 不保留旧 skill 激活中间语义
- 不保留旧 `progress / memory / turn / outcome` 结构
- 不保留旧 `watchdog` sidecar
- 不保留旧 prompt 中围绕 `memoryPatch + actionBatch/outcome` 的输出契约
- 不保留旧 `resultCode / resultMessage / resultData / attempts / localSourceStatus / localSourceSummary / finalDeliveryTaskId`

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
      types.ts
    utils/
      events.ts
      initialState.ts
      runtimeCache.ts
  constants.ts
  types.ts
```

目录归位原则：

- 只被单个 node 使用的逻辑，直接放回对应 node 目录。
- `prompts/**` 只负责 prompt 文本、prompt 输入类型和少量共享 prompt 片段。
- `node/utils/**` 只保留跨 node 复用、且没有明显单一归属的中性逻辑。
- node下的index要有主线流程与对应注释，方便阅读

## 4. 数据契约调整

### 4.1 `task`

`human` 输入统一使用 `taskId + userInput`：

```ts
interface HumanTaskInput {
  taskId: string
  userInput: string
}
```

### 4.2 `brainMemory`

- `brainMemory.inside` 仍只允许 `brain` 通过 `memoryOps` 改动。
- `brainMemory.outside.skillCatalog` 在 run 开始时预注入，供 `brain` 判断下一步要不要学习某个 skill。
- `brainMemory.outside.learnedSkillIds` 由 `learning` 维护，表示已经学习并可供后续 prompt 展开的 skill 集合。
- 不再持久化 `learnedSkills` 字符串；`brain` prompt 在运行时根据 `learnedSkillIds` 动态拼接已学习技能详情。
- `brainMemory.outside.brainDecisions` 保留最近决策历史，最多保留 10 条。

### 4.3 `lastBrainDecision` 与 `brainDecisions`

`lastBrainDecision` 仍保留为当前决策快照，供 `learning / hand / mouth` 读取本轮 `nextAction`；同时继续追加 `brainDecisions` 作为历史回看来源：

```ts
interface LastBrainDecision {
  memoryOps: BrainMemoryOp[]
  decision: BrainDecision
  nextAction: BrainNextAction
}

interface BrainDecisionRecord extends LastBrainDecision {
  createdAt: number
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

interface BrainFact {
  id: string
  summary: string
  evidenceIds: string[]
}

interface BrainEvidence {
  id: string
  toolName: string
  summary: string
  sourceType: 'tool_result'
  rawRef?: string
}

type BrainMemoryOp =
  | {
      op: 'add'
      field: 'facts'
      value: BrainFact
    }
  | {
      op: 'edit'
      field: 'facts'
      index: number
      value: BrainFact
    }
  | {
      op: 'add'
      field: 'evidences'
      value: BrainEvidence
    }
  | {
      op: 'edit'
      field: 'evidences'
      index: number
      value: BrainEvidence
    }
  | {
      op: 'add'
      field: 'openQuestions'
      value: string
    }
  | {
      op: 'edit'
      field: 'openQuestions'
      index: number
      value: string
    }
  | {
      op: 'remove'
      field: 'facts' | 'evidences' | 'openQuestions'
      index: number
    }
```

约束：

- `brain` 每轮都会写入新的 `lastBrainDecision`，并向 `brainDecisions` 追加一条新记录。
- `learning / hand / mouth` 只读取 `lastBrainDecision.nextAction` 作为当前分发依据。
- `brain` 自身不直接读取 `lastBrainDecision`，prompt 侧只读取最近决策历史的易读摘要字符串。
- `memoryOps` 中：
  - `add` / `edit` 必须提供 `value`
  - `edit` / `remove` 必须提供合法 `index`
  - `facts[].evidenceIds` 只能引用当前已存在或本轮新增的 evidence id
  - 对“本轮新增 evidence id”的引用校验必须与 `memoryOps` 数组顺序无关；不能因为先 add fact、后 add evidence，就把该 fact 误判为非法

### 4.4 `watchHint`

`watchHint` 是 `human` 内部统一的轻量收敛/纠偏提示，不再存在独立 `watchdog` 子系统。

典型来源：

- `hand` 工具调用次数超过临时上限（默认先设为 50 次）
- `learning` 收到已学习过的 skill 请求
- `memoryReducer` 处理非法 `edit/remove` 操作

这些情况不直接破坏当前 state，而是写入 `watchHint` 并返回 `brain` 重新决策。

### 4.5 `result`

`mouth` 仍是唯一写入 `result` 的节点，结构收紧为：

```ts
interface HumanResult {
  status: 'completed' | 'blocked'
  summary: string
  deliveryMarkdown?: string
}
```

### 4.6 `main` 任务结果契约

`main` 的任务结果字段同步收紧：

```ts
interface MainPlanTask {
  id: string
  title: string
  userInput: string
  status: 'ready' | 'running' | 'completed' | 'blocked'
  deliveryMarkdown?: string
}
```

补充约束：

- 计划任务初始状态统一为 `ready`，不再使用 `pending`。
- `blocked` 表示任务已派发给 `human` 且最终阻塞，不与“尚未执行”混用。
- `main` 最终只保留 `finalDeliveryMarkdown` 作为正式交付。

## 5. 节点职责

### 5.1 `brainNode`

- 唯一推理节点。
- 输入只面向易理解信息组织：
  - 用户的要求
  - 当前记忆数据
  - 最近一次工具结果
  - 最近决策历史摘要
  - 收敛提醒
- 输出本轮 `LastBrainDecision`，并同步沉淀一条 `BrainDecisionRecord`。
- 只通过 `memoryOps` 更新 `brainMemory.inside`。
- 通过 `memoryReducer` 对非法 `memoryOps` 做安全处理；如果修改失败，则写入 `watchHint` 并返回下一轮 `brain`。
- `memoryReducer` 对 evidence 引用的校验必须支持“当前已存在 + 本轮新增”两类 evidence id，且这一判断不依赖 `memoryOps` 数组顺序。
- 不直接加载 skill，不直接执行工具，不直接生成最终交付。

这里的“最近决策历史摘要”只保留：

- `decision`
- `nextAction`
- `createdAt`

这样做的目的，是让模型知道最近几轮：

- 做了什么判断
- 准备进入什么动作
- 这些动作发生在什么时间顺序上

而不是不加筛选地把整个运行态对象原样重新喂回去。
如果某段输入本身强依赖结构细节，例如记忆快照、最近工具结果、`nextAction` 载荷，那么可以保留这些关键字段的结构化原貌。

### 5.2 `learningNode`

- 只在 `nextAction.action='learning'` 时执行。
- 读取 `lastBrainDecision.nextAction.wantLearnSkillIds`。
- `skillCatalog` 在 run 开始时已注入，这里不负责懒加载目录摘要。
- 对未学习过的 skill，更新 `brainMemory.outside.learnedSkillIds`。
- 对已学习过的 skill，不重复执行，而是写入 `watchHint` 并返回 `brain` 重新决策。
- skill 详细说明不写回 state，而是在 `brain` prompt 拼装阶段根据 `learnedSkillIds` 动态生成。

### 5.3 `handNode`

- 只在 `nextAction.action='hand'` 时执行。
- 读取 `lastBrainDecision.nextAction.parallelCallToolParam`。
- 执行一个或多个工具调用，写入 `lastParallelCallToolResults`。
- 统计累计工具调用次数；超过临时动作上限（默认先设为 50）时写入 `watchHint`，由下一轮 `brain` 判断是否收敛。

### 5.4 `mouthNode`

- 只在 `nextAction.action='mouth'` 时执行。
- 读取 `lastBrainDecision.nextAction.status`、最后一次正式决策、`brainMemory.inside` 和必要的工具结果。
- 调用模型对已有信息做最终整理，生成 `summary` 与 `deliveryMarkdown`。
- 不补编新事实，只负责把已有结论整理成可交付结果。

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
- 最终输出稳定映射到 `LastBrainDecision`，并可直接追加为 `BrainDecisionRecord`。

设计要点：

- 角色描述不写 `brainNode`，而写“负责分析和决策的大脑角色”。
- 输入部分用自然语言组织：
  - 用户的要求
  - 你之前沉淀下来的记忆
  - 当前可用技能目录、已学习 skill id，以及根据这些 id 动态拼装出的技能说明
  - 最近一轮工具结果
  - 最近决策历史摘要
  - 当前收敛提醒
- 最近决策历史摘要只给 `decision + nextAction + createdAt`，不把原始 state 对象原样塞回去。
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

    输出结构固定为：
    {
      "memoryOps": [
        | {
            "op": "add",
            "field": "facts",
            "value": {
              "id": "fact-id",
              "summary": "string",
              "evidenceIds": ["evidence-id"]
            }
          }
        | {
            "op": "edit",
            "field": "facts",
            "index": 0,
            "value": {
              "id": "fact-id",
              "summary": "string",
              "evidenceIds": ["evidence-id"]
            }
          }
        | {
            "op": "add",
            "field": "evidences",
            "value": {
              "id": "evidence-id",
              "toolName": "tool_name",
              "summary": "string",
              "sourceType": "tool_result",
              "rawRef": "optional-string"
            }
          }
        | {
            "op": "edit",
            "field": "evidences",
            "index": 0,
            "value": {
              "id": "evidence-id",
              "toolName": "tool_name",
              "summary": "string",
              "sourceType": "tool_result",
              "rawRef": "optional-string"
            }
          }
        | {
            "op": "add",
            "field": "openQuestions",
            "value": "string"
          }
        | {
            "op": "edit",
            "field": "openQuestions",
            "index": 0,
            "value": "string"
          }
        | {
            "op": "remove",
            "field": "facts" | "evidences" | "openQuestions",
            "index": 0
          }
      ],
      "decision": {
        "summary": "string",
        "reason": "string",
        "expectedOutcome": "string"
      },
      "nextAction":
        | {
            "action": "learning",
            "wantLearnSkillIds": ["skill-id"]
          }
        | {
            "action": "hand",
            "parallelCallToolParam": [
              {
                "toolName": "tool_name",
                "args": {}
              }
            ]
          }
        | {
            "action": "mouth",
            "status": "completed" | "blocked"
          }
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
    - nextAction.wantLearnSkillIds：字符串数组。仅在 action=learning 时出现，表示本轮要学习的 skill id 列表。
    - nextAction.parallelCallToolParam：数组。仅在 action=hand 时出现，表示本轮要执行的工具调用列表。
    - nextAction.parallelCallToolParam[].toolName：字符串。要调用的工具名。
    - nextAction.parallelCallToolParam[].args：对象。对应工具的调用参数。
    - nextAction.status：字符串枚举。仅在 action=mouth 时出现，只能是 completed 或 blocked。
  </output_rules>

  <output_principles>
    - 当你已经有足够依据交付结果时，优先输出 mouth。
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
          "action": "mouth",
          "status": "completed"
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
    {当前可用的技能目录、已学习的 skill id，以及根据这些 id 动态生成的技能说明}
  </skill_context>

  <recent_tool_results>
    {最近一轮工具调用带回来的结果；如果没有，则写 none}
  </recent_tool_results>

  <recent_decision_history>
    {推荐按下面模板逐条拼接：
    - 第{相对轮次}轮（createdAt={时间戳或相对时间说明}）：决定“{decision.summary}”；原因：{decision.reason}；预期结果：{decision.expectedOutcome}；nextAction.action={nextAction.action}；nextAction数据：{直接写 nextAction 中除 action 之外的字段数据；如果是 learning 则写 wantLearnSkillIds，如果是 hand 则直接写 parallelCallToolParam 原始数组，如果是 mouth 则写 status}
    示例：
    - 第2轮（createdAt=1710926400000）：决定“先学习 docx-read”；原因：当前需要先明确 docx 的读取方式；预期结果：获得足够的技能说明后再决定是否调用工具；nextAction.action=learning；nextAction数据：wantLearnSkillIds=[docx-read]
    - 第3轮（createdAt=1710926460000）：决定“调用 KB 检索获取证据”；原因：当前缺少可引用的直接依据；预期结果：拿到证据后判断是否收敛；nextAction.action=hand；nextAction数据：parallelCallToolParam=[{"toolName":"kb_hybrid_search_chunks","args":{"query":"项目风险控制要求"}}]
    如果没有，则写 none}
  </recent_decision_history>

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
  - 最后一次正式决策的自然语言说明
  - 已确认事实
  - 关键证据
  - 必要时附带最近一轮关键工具结果
- 输出规则中直接给 JSON 结构和字段解释

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

    输出结构固定为：
    {
      "status": "completed" | "blocked",
      "summary": "string",
      "deliveryMarkdown": "string"
    }

    字段解释：
    - status：字符串枚举。表示任务最终状态，只能是 completed 或 blocked。
    - summary：字符串。面向用户的一句简洁结果摘要。
    - deliveryMarkdown：字符串。最终正式交付内容，必须是完整 markdown 正文。
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
    {推荐按下面模板拼接：
    - 最终决定：“{decision.summary}”；原因：{decision.reason}；预期结果：{decision.expectedOutcome}；结束状态{nextAction.status}
    示例：
    - 最终决定：“当前已经可以结束任务”；原因：现有证据已足够支撑最终结论，没有必要继续扩展动作；预期结果：由表达节点整理出最终结果；结束状态completed
    如果没有，则写 none}
  </final_decision>

  <facts>
    {已经确认的事实列表}
  </facts>

  <evidences>
    {支撑这些事实的关键证据列表}
  </evidences>
</user_context>
```
