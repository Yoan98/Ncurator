# NCurator-Desktop AI 实现规范

本文定义 `main + human` 的当前实现契约。代码实现应优先对齐本文档；本文中的状态转移只描述 graph 行为

## 1. `main`

### 1.1 运行模型

- `main` 以 `@langchain/langgraph` 的 `StateGraph` 为运行骨架，状态 schema 由 `main/state/schema.ts` 提供。
- `main` graph 的节点返回 `Partial<AiRunState>` 形式的 state patch，由 graph 负责状态推进。
- `main` 的条件路由由 `MainState.mainStage` 和 `MainState.status` 决定，不在 graph 外额外手写控制循环。

状态转移：

```text
START -> main_intent
main_intent -> main_direct_human_exec | main_context_human | main_plan | main_plan_exec | main_synthesis_human | main_complete
main_context_human -> main_intent
main_direct_human_exec -> main_complete
main_plan -> main_plan_exec | main_complete
main_plan_exec -> main_plan_exec | main_synthesis_human
main_synthesis_human -> main_complete
main_complete -> END
```

对应数据结构：

- `MainState`
- `MainPlanTask`
- `AiArtifactRef`
- `HumanTaskInput`
- `HumanRunDispatchOptions`
- `HumanTaskOutput`

对应流转图：

- `main` 直接路径：`direct human`
- `main` 阶段一：输入进入 `context / plan`
- `main` 阶段二：计划派发、结果回写、最终收尾

### 1.2 `main_intent`

- 运行模型：LangGraph 节点
- 触发条件：
  - graph 起点
  - `main_context_human` 返回后重新判断
- 读取：
  - `MainState.input`
  - `MainState.contextRounds`
  - `MainState.contextEvidence`
  - 会话历史摘要与最近对话
  - `ctx.selectedScopeSummary`
- 回写：
  - `MainState.mainStage`
  - 必要时回写 `MainState.contextObjective`
- 下一跳：
  - `main_direct_human_exec`
  - `main_context_human`
  - `main_plan`
- 实现约束：
  - 节点入口先调用 `ctx.checkCancelled()`
  - 超过上下文补充轮次上限时，直接进入 `main_plan`
  - 模型输出必须通过 `ctx.chatStructured`
  - prompt 必须通过 `buildIntentPrompt` 组织
  - 节点返回值应保持为 `Partial<AiRunState>`
- 对应数据结构：
  - `MainState.input`
  - `MainState.contextRounds`
  - `MainState.contextObjective`
  - `MainState.mainStage`
- 对应流转图：
  - `main` 直接路径：`direct human`
  - `main` 阶段一：输入进入 `context / plan`

### 1.3 `main_context_human`

- 运行模型：LangGraph 节点
- 触发条件：`MainState.mainStage = main_context_human`
- 读取：
  - `MainState.input`
  - `MainState.contextObjective`
  - `MainState.contextEvidence`
  - `MainState.contextRounds`
- 调用：
  - 派发一个 `human` 任务
  - `deliveryMode = context_note`
  - `internalDelivery = true`
- 回写：
  - `MainState.contextRounds += 1`
  - `MainState.contextEvidence`
  - `MainState.contextObjective = undefined`
  - `MainState.mainStage = main_intent`
- 下一跳：
  - `main_intent`
- 实现约束：
  - `taskId` 使用 `context-${contextRounds + 1}` 形式
  - `userInput` 通过 `buildContextHumanObjective` 生成，不直接把原始输入原样派发
  - `contextEvidence` 优先从 `context_note` 的可复用证据区提取
  - 提取结果通过去重/追加逻辑并入现有 `contextEvidence`
- 对应数据结构：
  - `MainState.contextObjective`
  - `MainState.contextRounds`
  - `MainState.contextEvidence`
  - `HumanTaskInput`
  - `HumanTaskOutput`
- 对应流转图：
  - `main` 阶段一：输入进入 `context / plan`

### 1.4 `main_direct_human_exec`

- 运行模型：LangGraph 节点
- 触发条件：`MainState.mainStage = main_direct_human_exec`
- 读取：
  - `MainState.input`
  - `MainState.contextEvidence`
- 调用：
  - 派发一个 `human` 任务
  - `deliveryMode = user_answer`
  - `streamAnswer = true`
- 回写：
  - `MainState.finalDeliveryMarkdown`
  - `MainState.finalArtifacts`
  - `MainState.mainStage = main_complete`
- 下一跳：
  - `main_complete`
- 实现约束：
  - `taskId` 固定为 direct human 专用任务 id
  - `userInput` 通过 `buildDirectHumanObjective` 生成
  - `main` 只消费 `HumanTaskOutput`，不直接读取 `human` 内部状态
- 对应数据结构：
  - `MainState.finalDeliveryMarkdown`
  - `MainState.finalArtifacts`
  - `HumanTaskOutput`
- 对应流转图：
  - `main` 直接路径：`direct human`

### 1.5 `main_plan`

- 运行模型：LangGraph 节点
- 触发条件：`MainState.mainStage = main_plan`
- 读取：
  - `MainState.input`
  - `MainState.contextEvidence`
  - 会话历史摘要与最近对话
  - `ctx.selectedScopeSummary`
- 输出：
  - 计划任务列表
- 回写：
  - `MainState.plan`
  - `MainState.dispatchCursor = 0`
  - `MainState.mainStage = main_plan_exec`
  - 失败时回写 `MainState.status = failed`、`MainState.error`
- 下一跳：
  - `main_plan_exec`
  - `main_complete`
- 实现约束：
  - 模型输出必须通过 `ctx.chatStructured`
  - prompt 必须通过 `buildPlanPrompt` 组织
  - 计划结果必须先经过 `validatePlannerTasks` 校验，再转换为 `MainPlanTask`
  - 每个计划任务都必须能交给单个 `human` 闭环执行
- 对应数据结构：
  - `MainState.plan`
  - `MainState.dispatchCursor`
  - `MainPlanTask`
- 对应流转图：
  - `main` 阶段一：输入进入 `context / plan`

### 1.6 `main_plan_exec`

- 运行模型：LangGraph 节点
- 触发条件：`MainState.mainStage = main_plan_exec`
- 读取：
  - `MainState.plan`
  - `MainState.dispatchCursor`
  - `MainState.input`
  - `MainState.contextEvidence`
  - 之前任务的 `deliveryMarkdown`
  - `ctx.selectedScopeSummary`
- 调用：
  - 按 `dispatchCursor` 串行派发 `human`
  - `deliveryMode = task_handoff`
- 回写：
  - 当前任务 `status`
  - 当前任务 `deliveryMarkdown`
  - 当前任务 `artifacts`
  - `MainState.dispatchCursor`
  - `MainState.mainStage`
- 下一跳：
  - `main_plan_exec`
  - `main_synthesis_human`
- 实现约束：
  - 当前策略是串行 `stop-dispatch`
  - 没有待执行任务时直接进入 `main_synthesis_human`
  - 任务派发前先把当前任务标记为 `running`
  - `blocked` 任务会停止后续业务任务，但仍进入 synthesis 收口
  - 回写时只更新当前已派发任务，不重写其他任务结果
- 对应数据结构：
  - `MainState.plan`
  - `MainState.dispatchCursor`
  - `MainPlanTask.status`
  - `MainPlanTask.deliveryMarkdown`
  - `MainPlanTask.artifacts`
  - `HumanTaskOutput`
- 对应流转图：
  - `main` 阶段二：计划派发、结果回写、最终收尾

### 1.7 `main_synthesis_human`

- 运行模型：LangGraph 节点
- 触发条件：`MainState.mainStage = main_synthesis_human`
- 读取：
  - `MainState.input`
  - `MainState.contextEvidence`
  - `MainState.plan`
  - `ctx.selectedScopeSummary`
- 调用：
  - 派发一个 `human` 任务
  - `deliveryMode = user_answer`
  - `streamAnswer = true`
- 回写：
  - `MainState.finalDeliveryMarkdown`
  - `MainState.finalArtifacts`
  - `MainState.mainStage = main_complete`
- 下一跳：
  - `main_complete`
- 实现约束：
  - synthesis 只面向最终用户输出，不再生成新的计划任务
  - `finalArtifacts` 需要合并计划阶段已有 artifacts 与 synthesis 输出 artifacts
  - `userInput` 通过 `buildSynthesisHumanObjective` 组织
- 对应数据结构：
  - `MainState.plan`
  - `MainState.finalDeliveryMarkdown`
  - `MainState.finalArtifacts`
  - `HumanTaskOutput`
- 对应流转图：
  - `main` 阶段二：计划派发、结果回写、最终收尾

### 1.8 `main_complete`

- 运行模型：LangGraph 节点
- 触发条件：`MainState.mainStage = main_complete`
- 读取：
  - `MainState.status`
  - `MainState.finalDeliveryMarkdown`
  - `MainState.finalArtifacts`
- 回写：
  - 正常路径下回写 `MainState.status = completed`
  - 保持 `MainState.mainStage = main_complete`
- 下一跳：
  - `END`
- 实现约束：
  - `main_complete` 只负责 run 级收尾，不再派发模型节点
  - 已处于 `failed / cancelled / completed` 的 run 不应被二次覆盖
- 对应数据结构：
  - `MainState.status`
  - `MainState.finalDeliveryMarkdown`
  - `MainState.finalArtifacts`
- 对应流转图：
  - `main` 直接路径：`direct human`
  - `main` 阶段二：计划派发、结果回写、最终收尾

## 2. `human`

### 2.1 运行模型

- `human` 以 `@langchain/langgraph` 的 `StateGraph` 为运行骨架，状态 schema 由 `human/state/schema.ts` 提供。
- `human` graph 的节点返回下一版 `HumanState`；调度仍由 graph 决定，不在 runner 外手写循环。
- `createHumanGraphRunner` 负责创建 graph、注入 `deliveryMode` 与 runtime cache，并把最终 `HumanState` 转换为 `HumanTaskOutput`。
- 当前 runner 使用固定 recursion limit，防止 graph 漂移。

状态转移：

```text
START -> brain
brain -> learning | hand | mouth | brain
learning -> brain
hand -> brain
mouth -> brain | END
```

对应数据结构：

- `HumanState`
- `BrainEvidence`
- `BrainFact`
- `LastBrainDecision`
- `BrainDecisionRecord`
- `ToolCallResult`
- `HumanResult`
- `HumanTaskOutput`
- `HumanTraceStep`

对应流转图：

- `human` 阶段一：`brain` 读取输入并产出决策
- `human` 阶段二：`learning` 路径的数据流转
- `human` 阶段三：`hand` 路径的数据流转
- `human` 阶段四：`mouth` 路径的数据流转

### 2.2 `brain`

- 运行模型：LangGraph 节点
- 触发条件：`runtime.stage = brain`
- 读取：
  - `HumanState.task`
  - `HumanState.brainMemory`
  - `HumanState.lastParallelCallToolResults`
  - `HumanState.watchHint`
  - 最近决策历史摘要
- 输出：
  - `LastBrainDecision`
- 回写：
  - `HumanState.brainMemory.inside`
  - `HumanState.brainMemory.outside.brainDecisions`
  - `HumanState.lastBrainDecision`
  - `HumanState.runtime.stage`
  - `HumanState.watchHint`
  - `HumanState.trace.steps`
- 下一跳：
  - `learning`
  - `hand`
  - `mouth`
  - 当 memory reducer 产出 `watchHint` 时留在 `brain`
- 实现约束：
  - 模型输出必须通过 `ctx.chatStructured`
  - prompt 必须通过 `buildBrainPromptContext`
  - 输出必须先经过 `parseBrainDecisionOutput`
  - `brainMemory.inside` 的修改必须经过 `reduceBrainMemory`
  - `brainDecisions` 只保留最近 10 条
  - `brain` 回看历史时只消费摘要，不直接把 `lastBrainDecision` 重新喂回
  - `brain` 是唯一推理节点
- 对应数据结构：
  - `HumanState.brainMemory.inside`
  - `HumanState.brainMemory.outside.brainDecisions`
  - `LastBrainDecision`
  - `BrainDecisionRecord`
  - `BrainMemoryOp`
- 对应流转图：
  - `human` 阶段一：`brain` 读取输入并产出决策

### 2.3 `learning`

- 运行模型：LangGraph 节点
- 触发条件：`lastBrainDecision.nextAction.action = learning`
- 读取：
  - `lastBrainDecision.nextAction.wantLearnSkillIds`
  - `brainMemory.outside.learnedSkillIds`
  - skill registry / loader
- 回写：
  - `brainMemory.outside.learnedSkillIds`
  - `runtime.stage = brain`
  - 必要时回写 `watchHint`
  - `trace.steps`
- 下一跳：
  - `brain`
- 实现约束：
  - `learning` 不调用模型
  - 未知 skill 或重复学习必须写 `watchHint` 并返回 `brain`
  - `ensureSkillTools` 负责把 skill 对应工具装入 runtime cache
  - `learning` 只更新已学习 skill 集合，不扩张为新推理节点
- 对应数据结构：
  - `SkillCatalogItem`
  - `HumanState.brainMemory.outside.learnedSkillIds`
  - `HumanTraceStep`
- 对应流转图：
  - `human` 阶段二：`learning` 路径的数据流转

### 2.4 `hand`

- 运行模型：LangGraph 节点
- 触发条件：`lastBrainDecision.nextAction.action = hand`
- 读取：
  - `lastBrainDecision.nextAction.parallelCallToolParam`
  - `brainMemory.outside.learnedSkillIds`
  - runtime cache 中已装载的工具
- 回写：
  - `lastParallelCallToolResults`
  - `runtimeArtifacts`
  - `runtime.stage = brain`
  - 必要时回写 `watchHint`
  - `trace.steps`
- 下一跳：
  - `brain`
- 实现约束：
  - `hand` 不调用模型
  - 工具批次先经过 `validateParallelToolCalls`
  - 工具执行通过 `executeToolCall` 并行完成
  - tool call count 超限时只写 `watchHint`，由下一轮 `brain` 决定是否收敛
  - `runtimeArtifacts` 只从工具结构化结果提取并合并
- 对应数据结构：
  - `ToolCallParam`
  - `ToolCallResult`
  - `HumanState.runtimeArtifacts`
  - `AiArtifactRef`
  - `HumanTraceStep`
- 对应流转图：
  - `human` 阶段三：`hand` 路径的数据流转

### 2.5 `mouth`

- 运行模型：LangGraph 节点
- 触发条件：`runtime.stage = mouth`
- 读取：
  - `HumanState.task`
  - `HumanState.brainMemory.inside`
  - `HumanState.lastBrainDecision`
  - `HumanState.runtimeArtifacts`
  - `deliveryMode`
- 输出：
  - `MouthOutput`
- 回写：
  - `HumanState.result`
  - `HumanState.runtime.status`
  - `HumanState.runtime.stage = mouth`
  - `HumanState.trace.steps`
- 下一跳：
  - 结束当前 `human` run
  - 少数需要继续运行的特殊场景才允许回到 `brain`
- 实现约束：
  - 最终状态由 `lastBrainDecision.nextAction.status` 推导，不由 `mouth` 自行决定
  - 模型输出必须通过 `ctx.chatStructured`
  - prompt 必须通过 `buildMouthPromptContext`
  - `deliveryMarkdown` 为空时，必须使用 fallback builder 补足
  - `artifacts` 由 runtime 透传到 `result`，不是由 `mouth` 生成
  - `mouth` 不补编新事实，不扩张 artifacts
- 对应数据结构：
  - `MouthOutput`
  - `HumanResult`
  - `HumanTaskOutput`
  - `AiArtifactRef`
- 对应流转图：
  - `human` 阶段四：`mouth` 路径的数据流转

### 2.6 `human` 共享状态规则

- `lastBrainDecision` 是当前分发快照，服务 `learning / hand / mouth` 读取当前动作。
- `brainDecisions` 是最近决策历史，只保留最近 10 条，用于回看和审计。
- `watchHint` 是轻量纠偏信号，不单独形成一个新节点。
- `runtimeArtifacts` 只在 `hand` 阶段增长，在 `mouth` 阶段透传。
- `trace.steps` 由各节点持续追加，供事件、审计与回放使用。

对应数据结构：

- `LastBrainDecision`
- `BrainDecisionRecord`
- `HumanState.watchHint`
- `HumanState.runtimeArtifacts`
- `HumanTraceStep`

## 3. 跨层实现规则

### 3.1 `main` 与 `human` 的派发契约

- `main` 与 `human` 的稳定边界是：
  - 输入：`HumanTaskInput + HumanRunDispatchOptions`
  - 输出：`HumanTaskOutput`
- `main` 只调用 `HumanTaskRunner`，不直接读写 `HumanState`。
- `human` runner 负责把最终 `HumanState` 收口为稳定的 `HumanTaskOutput`。

对应数据结构：

- `HumanTaskInput`
- `HumanRunDispatchOptions`
- `HumanTaskOutput`

### 3.2 `deliveryMode`

- `main_direct_human_exec` 与 `main_synthesis_human` 使用 `user_answer`
- `main_plan_exec` 使用 `task_handoff`
- `main_context_human` 使用 `context_note`
- `deliveryMode` 只影响 `mouth` 的交付组织方式，不改变前置节点职责。

对应数据结构：

- `HumanRunDispatchOptions.deliveryMode`
- `HumanResult.deliveryMarkdown`

### 3.3 `contextEvidence`

- `contextEvidence` 是 `main` 侧消费的证据摘要，不直接保存整段 `context_note`。
- 提取来源优先是 `context_note` 中的“可复用证据”区块。
- 提取失败时，才 fallback 到 `HumanTaskOutput.summary`。
- intent / routing 的判定理由不写入 `contextEvidence`。

对应数据结构：

- `MainState.contextEvidence`
- `HumanTaskOutput.summary`
- `HumanTaskOutput.deliveryMarkdown`

### 3.4 `artifacts`

- `artifacts` 的产生源头是工具结构化输出。
- `hand` 负责把工具结果提取为 `runtimeArtifacts`。
- `mouth` 只透传 `runtimeArtifacts` 到 `HumanResult`。
- `main_plan_exec` 把子任务 artifacts 回写到 `MainPlanTask.artifacts`。
- `main_synthesis_human` / `main_complete` 负责合并并收口到 `MainState.finalArtifacts`。

对应数据结构：

- `AiArtifactRef`
- `HumanState.runtimeArtifacts`
- `HumanResult.artifacts`
- `MainPlanTask.artifacts`
- `MainState.finalArtifacts`

### 3.5 技术实现约束

- `main` 与 `human` 的运行编排必须基于 `@langchain/langgraph` 的 `StateGraph`。
- graph 的状态 schema 必须通过各自目录下的 `state/schema.ts` 定义和约束。
- graph 路由必须通过 `addConditionalEdges` 或等价 graph 路由表达，不要在 graph 外另写一套手工循环替代。
- 模型结构化输出必须统一通过 `ctx.chatStructured`，由 runtime 封装的 `invokeStructuredChat` 承接。
- 如果后续需要引入非结构化模型调用，也应先补 runtime 级封装，不在 node 内直接拼接底层模型调用。
- 节点内部不要直接调用 `model.withStructuredOutput`，也不要散落手写 schema parse 逻辑。
- prompt 必须通过 `build*Prompt` 或 `build*PromptContext` 组织，不在 node 内联堆大段 prompt 文本。
- `learning`、`hand`、`complete` 这类确定性节点默认不引入额外模型调用。
- 节点入口先执行取消检查，再进行模型调用、工具调用或状态写入。
- 文档中的状态转移用于约束 graph 结构，不应用来反向实现一套脱离 LangGraph 的伪循环。

### 3.6 与数据文档的联动

- `main` 侧实现时，先对照 `data-definition-and-flow.md` 中的：
  - `MainState`
  - `MainPlanTask`
  - `main` 三张流转图
- `human` 侧实现时，先对照 `data-definition-and-flow.md` 中的：
  - `HumanState`
  - `brainMemory.inside`
  - `brainMemory.outside`
  - `lastBrainDecision` 与 `brainDecisions`
  - `lastParallelCallToolResults` 与 `result`
  - `human` 四张流转图
- 跨层派发与交付时，重点对照：
  - `HumanTaskInput`
  - `HumanRunDispatchOptions`
  - `HumanTaskOutput`
  - `AiArtifactRef`

## 4. 不变量

- `main` 只负责 run 级 orchestration。
- `human` 只负责 task 级 autonomous execution。
- `brain` 是唯一推理节点。
- `brainMemory.inside` 只允许通过 `brain` 的 `memoryOps` 修改。
- `lastBrainDecision` 只表示当前动作快照，`brainDecisions` 只表示最近历史。
- `deliveryMode` 只影响交付组织，不改变求解职责。
- `mouth` 不新增事实，不扩张 artifacts。
- `main` 与 `human` 之间只通过稳定交接契约通信，不直接穿透内部状态。
