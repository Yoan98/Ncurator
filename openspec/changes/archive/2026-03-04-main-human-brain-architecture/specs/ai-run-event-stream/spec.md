## MODIFIED Requirements

### Requirement: Emit run lifecycle events
系统 MUST 继续发出 run 生命周期事件（start/completed/failed/cancelled），并保证在 main/human 双层执行下相关事件可被同一 run 关联。

#### Scenario: Run lifecycle under dual-layer runtime
- **WHEN** run 在 main/human 协同下启动并结束
- **THEN** 事件流包含可关联同一 runId 的完整生命周期事件

### Requirement: Emit plan and task progression events
系统 MUST 发出计划与任务推进事件，并 MUST 区分 main 阶段编排与 human 单任务步骤执行语义。

#### Scenario: Plan tasks dispatched to human runs
- **WHEN** main 生成计划并派发任务
- **THEN** 事件流包含 plan 创建、任务派发与任务终态事件

#### Scenario: Human step execution does not masquerade as new plan
- **WHEN** human 在单任务内执行多步工具调用
- **THEN** 事件流表达为同一任务下的步骤推进，而非重复创建计划事件

### Requirement: Emit tool and terminal step events
系统 MUST 发出步骤级工具事件，并在动态 active tools 模式下记录该步骤工具集合上下文以支持回放与审计。

#### Scenario: Dynamic tool step execution
- **WHEN** brain 在某一步调用 active tools 中的工具
- **THEN** 事件流包含工具调用开始、结果、以及该步骤 active toolset 关联信息

### Requirement: Emit UI-friendly activity events
系统 MUST 发出可供 UI 渲染的 activity 事件，并覆盖 main 阶段与 human 步骤的关键动作。

#### Scenario: Activity rendering for dual-layer execution
- **WHEN** runtime 执行 probe、context、plan、tool step、finalization 等动作
- **THEN** activity 事件提供状态、动作类型和可读摘要

### Requirement: Emit workspace/approval gating events
系统 MUST 在步骤级执行中继续发出 workspace/approval 门禁事件，并保持门禁语义先于实际执行。

#### Scenario: Approval required before tool execution
- **WHEN** 本步骤工具被策略判定为审批门禁
- **THEN** 事件流先发出审批请求与审批结果，再决定是否执行

### Requirement: Emit final response stream events
系统 MUST 由 finalization 阶段发出最终响应 token 与完成事件，且顺序稳定。

#### Scenario: Final response after task aggregation
- **WHEN** main 完成任务聚合并进入 finalization
- **THEN** 事件流按顺序输出 answer token 与 answer completed 事件

### Requirement: Emit file artifact events
系统 MUST 对 terminal/docx 等产物写入继续发出 file artifact 事件，支持 UI 关联文件结果。

#### Scenario: Artifact emitted during human step
- **WHEN** human 步骤执行导致文件创建或更新
- **THEN** 事件流包含可关联 task 的 artifact 元数据

### Requirement: Keep event correlation stable
所有事件 MUST 提供稳定关联字段以支持 run、task、step、artifact 维度的确定性关联。

#### Scenario: Deterministic correlation in replay
- **WHEN** 系统回放混合事件流
- **THEN** 可基于关联字段稳定重建执行轨迹而无需启发式猜测

## ADDED Requirements

### Requirement: Emit broker and slot-commit observability events
系统 MUST 发出 Tool Broker 与 slot 提交相关可观测事件，至少覆盖 active tools 计算结果、被拒绝原因、slot 提交成功/失败。

#### Scenario: Broker and slot visibility
- **WHEN** human 完成一步工具执行并提交 slot
- **THEN** 事件流包含 broker 筛选快照与 slot 提交结果信息

