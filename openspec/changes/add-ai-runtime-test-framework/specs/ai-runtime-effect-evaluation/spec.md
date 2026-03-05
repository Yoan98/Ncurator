## ADDED Requirements

### Requirement: 系统 MUST 支持每个 tool 的效果测试
系统 MUST 提供针对每个 AI tool 的效果测试能力，覆盖输入输出契约、门禁行为与关键事件完整性。

#### Scenario: Tool 契约通过
- **WHEN** tool 输入满足约束且依赖准备完成
- **THEN** 测试 MUST 验证输出结构、结果码和关键字段满足契约要求

#### Scenario: Tool 门禁触发
- **WHEN** tool 执行命中 workspace 或 approval 门禁条件
- **THEN** 测试 MUST 验证返回结果码与事件语义符合门禁预期

### Requirement: 系统 MUST 支持 human 完成任务效果测试
系统 MUST 评估 human 子图在单任务执行中的循环行为、失败分级策略与收敛质量。

#### Scenario: 可恢复失败继续探索
- **WHEN** human 工具步骤返回可恢复失败（如 `failed` 或 `invalid_input`）
- **THEN** 测试 MUST 验证流程回到 brain 并继续后续步骤

#### Scenario: 不可恢复失败阻塞收敛
- **WHEN** human 工具步骤返回不可恢复失败（如 `workspace_required` 或 `approval_denied`）
- **THEN** 测试 MUST 验证任务以阻塞状态收敛并输出阻塞原因

### Requirement: 系统 MUST 支持 main 补上下文效果测试
系统 MUST 支持对 context enrich 的效果进行可比较评估，并输出可复核的对照结果。

#### Scenario: A/B 对照执行
- **WHEN** 同一任务分别在“无 context enrich”和“有 context enrich”两种策略下执行
- **THEN** 测试 MUST 输出两组结果并提供可比较指标

#### Scenario: 上下文效果判定
- **WHEN** context enrich 执行完成并进入后续 plan/dispatch
- **THEN** 测试 MUST 计算并记录成功率、阻塞率或证据有效性等效果指标

### Requirement: 系统 MUST 支持 plan 生成效果测试
系统 MUST 评估 plan 生成与计划执行链路的结构正确性和执行有效性。

#### Scenario: 计划结构合法
- **WHEN** main plan 节点生成任务列表
- **THEN** 测试 MUST 验证任务结构完整、objective 非空且可执行

#### Scenario: 计划执行链路可观测
- **WHEN** plan 进入 task 派发与执行阶段
- **THEN** 测试 MUST 验证关键事件链路存在且顺序满足架构约束

### Requirement: 效果测试 MUST 提供回归门槛与退化告警
系统 MUST 为四类效果测试定义可配置门槛，并在指标退化时给出明确告警。

#### Scenario: 指标达到门槛
- **WHEN** 本次测试结果满足预设门槛
- **THEN** 测试结果 MUST 标记为通过并记录基线比较结果

#### Scenario: 指标低于门槛
- **WHEN** 本次测试结果低于预设门槛
- **THEN** 测试结果 MUST 标记为失败并输出退化指标与失败分类
