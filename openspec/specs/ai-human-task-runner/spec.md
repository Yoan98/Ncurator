# ai-human-task-runner Specification

## Purpose
TBD - created by archiving change main-human-brain-architecture. Update Purpose after archive.
## Requirements
### Requirement: Execute single-task human graph with brain-driven loop
系统 MUST 为每个 plan 任务启动独立 human 运行实例，并在该实例内以 `brain -> (skill_loader | tool_exec) -> brain` 的步骤循环推进；human 最小输入契约 MUST 为 `taskId` 与 `objective`，不得依赖 `mode` 字段。

#### Scenario: One task one human run
- **WHEN** main graph 派发一个待执行任务到 human
- **THEN** runtime MUST 为该任务创建独立 human 运行上下文，并以 `taskId/objective` 作为输入开始步骤循环，最终以 `status/summary/resultCode/resultData` 返回任务结果

#### Scenario: Recoverable failure continues exploration
- **WHEN** human 步骤中的普通工具调用返回可恢复失败（如 `failed` 或 `invalid_input`）
- **THEN** runtime MUST 回到 brain 进入下一步探索，而不是立即以阻塞终态结束任务

#### Scenario: Task isolation across plan items
- **WHEN** plan 中存在多个任务
- **THEN** 每个任务在独立 human 实例中执行且不共享隐式运行态

### Requirement: Use brain as the only step decision maker
在 human 运行中，brain MUST 成为唯一的步骤决策入口，并 MUST 基于 `availableSkillCards`、已加载 skill 与最近 observation 输出结构化步骤决策。

#### Scenario: Brain loads a missing skill first
- **WHEN** brain 判断当前缺少完成任务所需能力
- **THEN** 输出 MUST 为 `load_skill`，并引用存在于 `availableSkillCards` 中的 `skillId`

#### Scenario: Brain invokes an active tool
- **WHEN** brain 判断当前 active skill 已足以推进任务
- **THEN** 输出 MUST 为 `invoke_tool`，并由 runtime 通过对应 `ToolNode(activeTools)` 执行

#### Scenario: Capability internal AI loop is disallowed
- **WHEN** capability 工具被 brain 选中并执行
- **THEN** capability 仅执行原子逻辑并返回结构化结果，不再运行内部 AI 决策循环

### Requirement: Enforce canonical step actions
brain 每一步输出 MUST 仅允许 `load_skill`、`invoke_tool`、`complete_task`、`block_task` 四类动作之一，且动作载荷 MUST 满足结构化 schema 校验；`complete_task` MUST 基于已满足目标的证据，`block_task` MUST 提供明确阻塞原因。

#### Scenario: Load skill action
- **WHEN** brain 判断当前缺少能力包
- **THEN** 输出 MUST 为 `load_skill`，并包含 `skillId`、`rationale`、`publicNarrative`

#### Scenario: Invoke tool action
- **WHEN** brain 判断需要执行外部能力
- **THEN** 输出 MUST 为 `invoke_tool`，并包含工具名、参数、`rationale` 与 `publicNarrative`

#### Scenario: Complete task with objective evidence
- **WHEN** brain 判定任务目标已完成
- **THEN** 输出 MUST 为 `complete_task`，并在摘要中包含完成结论与关键证据

#### Scenario: Block task on unrecoverable condition
- **WHEN** brain 判断任务在当前约束下不可继续（例如 workspace/approval 门禁导致不可推进）
- **THEN** 输出 MUST 为 `block_task`，并返回阻塞原因与可定位信息

### Requirement: Keep human loop bounded and cancellable
human 步骤循环 MUST 受最大步数、总耗时、取消信号约束，并在越界时以显式终态收敛，禁止无界循环。

#### Scenario: Step budget exceeded
- **WHEN** human 运行达到最大步骤预算
- **THEN** runtime 终止步骤循环并返回 `block_task` 终态

#### Scenario: Cancellation during human execution
- **WHEN** 运行过程中收到取消信号
- **THEN** human 立即停止后续步骤并向 main 报告取消终态
