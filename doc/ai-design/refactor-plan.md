# NCurator-Desktop AI 新架构重构计划

## 1. 目标

- 将 `human` 从旧的 `reason / execute / finalize` 结构，重构为 `brain / learning / hand / mouth`。
- 把 `human` 的状态、提示词和节点职责重新收敛成更简易、阅读性强、可扩展的结构。
- 明确 `brainMemory.inside` 与 `brainMemory.outside` 的边界，减少隐式状态和混合职责。

## 2. 当前计划范围

- 统一文档入口，完成 `doc/ai-design/` 目录化整理。
- 重定义 `human` state、brain contract 和节点流转。
- 重新设计 human 代码逻辑，优先保证更简易、阅读性强、可扩展。
- 后续再补充更细的实现步骤、拆分任务和测试计划。

## 3. 重构原则

- 只保留一个真正的思考节点，即 `brain`。
- `learning / hand / mouth` 必须保持执行型和可预测。
- 状态字段尽量少，但边界要清楚。
- prompt contract、state schema 和 reducer 必须统一。
- Human 目录和代码逻辑优先追求可读性，而不是过度抽象。

## 4. 初步阶段划分

### 第一阶段：文档与契约收敛

- 完成 AI 设计文档目录化拆分。
- 固化 `human` 新状态定义、数据流和节点职责。
- 固化 `brain` 输出 JSON contract。

### 第二阶段：状态与 graph 改造

- 改造 `stateSchemas.ts` 的 human state 定义。
- 改造 `humanGraph.ts` 的节点路由和状态推进。
- 移除旧的 `turn` 和旧 contract 依赖。
- 将旧 watchdog 侧车替换为 human 内部基于 `hand` 次数上限的 `watchHint` 保险机制。

### 第三阶段：节点与目录重构

- 拆分并重写 `brain / learning / hand / mouth` 目录与节点逻辑。
- 重写 memory reducer、skill 加载逻辑和工具调用逻辑。
- 简化事件投影和 trace 记录方式。

### 第四阶段：校验与清理

- 补齐类型、文档和测试契约。
- 清理旧目录、旧 prompt、旧 helper 和无效状态字段。
- 保证最终实现与文档一致。

## 5. 当前已确定事项

- 旧 `watchdog` 侧车不再保留在新 `human` 架构内。
- `human` 内部仍保留一个简单保险机制：基于 `hand` 调用次数上限生成 `watchHint`。
- `task` 收敛为 `taskId + userInput`。
- `runtime` 收敛为 `stage + status`。
- `brainMemory` 拆为 `inside / outside`。
- `brain` 常规输入收敛为 `task / brainMemory / lastParallelCallToolResults / lastBrainDecision.decision`，超过调用上限时额外读取 `watchHint`。
- `curBrainDecision` 字段移除，改为对象型 `lastBrainDecision`。
- `parallelCallToolParam` 改为数组，用于表达一轮 `hand` 内的并行工具调用。
- `result` 只保留 `status / summary / payload / deliveryMarkdown`。

## 6. 待补充事项

- `main` 是否需要进一步简化 state。
- `brain` 输出 contract 的最终字段细节。
- `learning` 的 skill 文本拼接格式与更新策略。
- `hand` 的工具执行批次能力是否保留。
- 新测试分层与迁移顺序。
