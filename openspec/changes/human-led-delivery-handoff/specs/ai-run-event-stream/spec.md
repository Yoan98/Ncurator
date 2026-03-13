## MODIFIED Requirements

### Requirement: Emit plan and task progression events
系统 MUST 发出计划与任务推进事件，并 MUST 区分 main 阶段编排、plan 业务任务执行与 synthesis human 汇总阶段的语义；事件流在 plan 模式下 MUST 能稳定表达业务任务推进与最终 synthesis 阶段，而不把 human 内部步骤伪装成新的 plan。

#### Scenario: Plan tasks dispatched to business human runs
- **WHEN** main 生成业务计划并派发任务
- **THEN** 事件流在计划执行阶段 MUST 包含 plan 创建、业务任务派发与业务任务终态事件

#### Scenario: Synthesis phase is observable after plan tasks
- **WHEN** plan 业务任务结束并进入 synthesis human
- **THEN** 事件流 MUST 继续表达该终端汇总阶段的稳定任务身份或等价可回放阶段信息，使 UI 能区分业务执行与最终汇总

#### Scenario: Human step execution does not masquerade as new plan
- **WHEN** human 在单任务内执行多步工具调用
- **THEN** 事件流 MUST 继续表达为同一任务下的步骤推进，而非重复创建计划事件

### Requirement: Emit UI-friendly activity events
系统 MUST 发出可供 UI 渲染的 activity 事件，并覆盖 main 阶段与 human 步骤的关键动作，包括 intent、context、plan、tool step、task delivery 与最终答复交付，而不再以 finalization 作为唯一收口动作。

#### Scenario: Activity rendering for direct human execution
- **WHEN** runtime 走 direct human 路径完成一次运行
- **THEN** activity 事件 MUST 能表达从执行到最终交付的关键动作，而不要求存在 plan 或 finalization 阶段

#### Scenario: Activity rendering for planned execution
- **WHEN** runtime 执行计划业务任务并进入 synthesis human
- **THEN** activity 事件 MUST 区分业务子任务推进、交付生成和最终总结交付

### Requirement: Emit final response stream events
系统 MUST 由 direct human 或 synthesis human 的 delivery 节点发出最终响应 token 与完成事件，且顺序稳定；plan 中间任务 MUST NOT 直接向用户发出最终答复流。

#### Scenario: Direct human streams final response
- **WHEN** main 选择 direct human 路径
- **THEN** 事件流 MUST 由该 human 的 delivery 阶段按顺序输出 answer token 与 answer completed 事件

#### Scenario: Synthesis human streams final response
- **WHEN** 计划执行结束并进入 synthesis human
- **THEN** 事件流 MUST 由 synthesis human 的 delivery 阶段按顺序输出 answer token 与 answer completed 事件

#### Scenario: Business task delivery does not masquerade as final answer
- **WHEN** 计划中的中间业务任务完成并生成 handoff
- **THEN** 事件流 MUST 记录任务交付，但 MUST NOT 把该交付当作最终用户答复流发出

## ADDED Requirements

### Requirement: Emit task delivery events
系统 MUST 在 human 任务生成正式交付后发出可回放的 task delivery 事件，以便 UI、测试与后续任务消费任务交付物。

#### Scenario: Completed task emits task delivery
- **WHEN** 任一 human 任务完成并生成正式交付
- **THEN** 事件流 MUST 发出包含 `runId`、`taskId`、`summary` 与 `deliveryMarkdown` 的 task delivery 事件

#### Scenario: Blocked task emits task delivery
- **WHEN** human 任务以阻塞终态结束并生成说明性交付
- **THEN** 事件流 MUST 仍然发出 task delivery 事件，使后续 synthesis 或人工回放能够读取该交付内容
