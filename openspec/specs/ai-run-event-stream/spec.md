# ai-run-event-stream Specification

## Purpose
TBD - created by archiving change langgraph-chat-ai-architecture. Update Purpose after archive.
## Requirements
### Requirement: Emit run lifecycle events
系统 MUST 继续发出 run 生命周期事件（start/completed/failed/cancelled），并保证在 main/human 双层执行下相关事件可被同一 run 关联。

#### Scenario: Run lifecycle under dual-layer runtime
- **WHEN** run 在 main/human 协同下启动并结束
- **THEN** 事件流包含可关联同一 runId 的完整生命周期事件

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

### Requirement: Emit tool and terminal step events
系统 MUST 发出步骤级工具事件，并在 skill activation 模式下记录该步骤的 active skills / active tools 上下文以支持回放与审计。

#### Scenario: Dynamic tool step execution
- **WHEN** brain 在某一步调用 active tools 中的工具
- **THEN** 事件流包含工具调用开始、结果、以及该步骤 active skills / active tools 关联信息

### Requirement: Emit UI-friendly activity events
系统 MUST 发出可供 UI 渲染的 activity 事件，并覆盖 main 阶段与 human 步骤的关键动作，包括 intent、context、plan、tool step、task delivery 与最终答复交付，而不再以 finalization 作为唯一收口动作。

#### Scenario: Activity rendering for direct human execution
- **WHEN** runtime 走 direct human 路径完成一次运行
- **THEN** activity 事件 MUST 能表达从执行到最终交付的关键动作，而不要求存在 plan 或 finalization 阶段

#### Scenario: Activity rendering for planned execution
- **WHEN** runtime 执行计划业务任务并进入 synthesis human
- **THEN** activity 事件 MUST 区分业务子任务推进、交付生成和最终总结交付

### Requirement: Emit workspace/approval gating events
系统 MUST 在步骤级执行中继续发出 workspace/approval 门禁事件，并保持门禁语义先于实际执行。

#### Scenario: Approval required before tool execution
- **WHEN** 本步骤工具被策略判定为审批门禁
- **THEN** 事件流先发出审批请求与审批结果，再决定是否执行

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

### Requirement: Keep human-step observability without slot events
系统 MUST 通过 `human_step` 持续表达 human 内部推进状态，并通过内部诊断事件保留 rationale 级调试信息，且 MUST 不再依赖 `slot_commit` 事件。

#### Scenario: Human step visibility in simplified runtime
- **WHEN** human 完成一步工具执行
- **THEN** 事件流包含可关联 task 的 `human_step` 信息（含 `publicNarrative`、active skills、active tools、步骤结果），并省略 slot 提交事件

### Requirement: 编辑运行的审阅就绪信号 MUST 在全部编辑任务完成后发出
系统在一次运行产生可审阅草稿时 MUST 仅在全部可编辑任务完成后暴露审阅就绪信号或审阅引用信息，并 MUST NOT 在运行中途发出逐块确认请求来打断当前执行。

#### Scenario: 多个编辑任务完成后统一进入审阅
- **WHEN** 一次运行内包含多个可编辑任务，且这些任务都已完成
- **THEN** 系统 MUST 只在最后一个相关任务完成后暴露统一的审阅就绪信息

### Requirement: 涉及可编辑文档的步骤事件 MUST 关联最新工作草稿身份
当某个能力在运行中对可编辑文档产生新的草稿快照后，后续与该文档相关的读取、搜索、预览和继续编辑步骤 MUST 关联最新工作草稿身份，而不是继续只关联原始源文件身份。

#### Scenario: 第二次读取看到第一次修改后的内容
- **WHEN** 文档先完成一次草稿编辑，再在同一运行中执行后续读取或搜索步骤
- **THEN** 后续步骤 MUST 能稳定关联到最新草稿快照，使 UI 和运行逻辑都能基于编辑后的内容继续工作

### Requirement: 用户可见步骤叙事 MUST 与内部诊断信息分离
系统 MUST 继续将用户可见的步骤叙事与内部诊断信息分离：用户界面使用的步骤事件 MUST 提供面向用户的 `publicNarrative`，而内部诊断细节 MUST 继续保留在独立的内部调试通道中。

#### Scenario: UI 展示步骤说明时不暴露内部推理
- **WHEN** Renderer 渲染一次运行的步骤时间线
- **THEN** UI MUST 使用用户可见叙事字段展示步骤说明，而不会依赖或暴露内部诊断内容

### Requirement: Emit task delivery events
系统 MUST 在 human 任务生成正式交付后发出可回放的 task delivery 事件，以便 UI、测试与后续任务消费任务交付物。

#### Scenario: Completed task emits task delivery
- **WHEN** 任一 human 任务完成并生成正式交付
- **THEN** 事件流 MUST 发出包含 `runId`、`taskId`、`summary` 与 `deliveryMarkdown` 的 task delivery 事件

#### Scenario: Blocked task emits task delivery
- **WHEN** human 任务以阻塞终态结束并生成说明性交付
- **THEN** 事件流 MUST 仍然发出 task delivery 事件，使后续 synthesis 或人工回放能够读取该交付内容

