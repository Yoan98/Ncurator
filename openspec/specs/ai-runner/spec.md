# ai-runner Specification

## Purpose
TBD - created by archiving change langgraph-chat-ai-architecture. Update Purpose after archive.
## Requirements
### Requirement: Require workspace binding for executable runs
运行时 MUST 在执行 workspace-bound 工具前校验 workspace 绑定，并将该门禁规则应用于 human 步骤级工具执行。

#### Scenario: Missing workspace during human step
- **WHEN** brain 选择执行需要 workspace 的工具且绑定信息缺失
- **THEN** 运行时阻断该步骤并返回明确的 workspace-required 结果

### Requirement: Use capability registry dispatch and fail fast on unknown kinds
任务与步骤执行 MUST 通过 capability registry 与工具元数据完成路由；未知 capability 或未知工具 MUST 快速失败并给出结构化错误。

#### Scenario: Unknown capability in task dispatch
- **WHEN** 计划任务引用未注册 capability
- **THEN** runtime 标记任务失败并返回 unsupported-capability 原因

#### Scenario: Unknown tool in human step
- **WHEN** brain 发起不在当前 active tools 集合内的工具调用
- **THEN** runtime 拒绝执行并返回结构化步骤错误

### Requirement: Support cancellation and fail-fast routing
运行时 MUST 在 main/human 双层都支持取消与失败快速收敛；取消发生后 MUST 停止当前 human、后续业务任务派发和 synthesis 调用；业务任务出现不可恢复阻塞时 MUST 停止后续业务任务，但在未取消的前提下 MUST 继续进入 synthesis human 汇总当前运行状态。

#### Scenario: Cancel during direct or planned human execution
- **WHEN** direct human、计划中的业务 human 或 synthesis human 执行过程中收到取消信号
- **THEN** runtime MUST 立即停止当前执行并结束 run，且不得继续派发剩余业务任务或 synthesis

#### Scenario: Unrecoverable business task block in plan mode
- **WHEN** 某个计划中的业务任务返回不可恢复的阻塞终态
- **THEN** main MUST 停止后续业务任务派发，并将已完成交付与阻塞信息带入 synthesis human，而不是继续盲目推进剩余业务任务

### Requirement: Use centralized prompt registry in runtime orchestration
运行时 MUST 通过统一 prompt registry 生成 main/human/memory 相关提示词，核心节点 MUST NOT 继续以内联字符串维护主提示词内容。

#### Scenario: Main node prompt resolution
- **WHEN** main intent/plan/finalize 节点触发模型调用
- **THEN** 节点 MUST 从 prompt registry 解析对应提示词并构建请求

#### Scenario: Human and memory prompt resolution
- **WHEN** human brain 或会话记忆更新触发模型调用
- **THEN** 相关模块 MUST 复用 registry 提供的提示词构建入口，并共享统一约束文本风格

### Requirement: Main graph MUST 只负责编排而不负责任务交付
系统 MUST 继续使用双层运行模型，其中 `main graph` 仅负责意图判断、上下文补充、计划生成、任务派发和 run 收尾；正式任务交付与最终用户答复 MUST 由 human 生成。

#### Scenario: Main graph orchestrates current runtime stages
- **WHEN** 新 run 启动
- **THEN** main graph MUST 按 `intent -> context human | direct human | plan -> plan exec -> synthesis human -> complete` 的当前架构推进，而不是进入 finalization 生成答复

#### Scenario: Legacy writing task shape appears
- **WHEN** 计划中出现 legacy writing-workflow 任务形态
- **THEN** runtime MUST 继续将其视为不支持的旧任务形态并拒绝调度

### Requirement: Main MUST route runs to direct human or planned execution
系统 MUST 在 main 层完成 `need_context | direct_human | to_plan` 三路路由决策；若无需 plan，runtime MUST 直接派发一个 direct human 执行用户请求并输出最终答复。

#### Scenario: Direct human path
- **WHEN** 用户请求可由单个 human 独立完成且不需要 plan
- **THEN** main MUST 派发 direct human，并由该 human 直接生成最终用户答复

#### Scenario: Plan execution path
- **WHEN** 用户请求需要多个业务子任务才能完成
- **THEN** main MUST 生成业务任务列表并逐个派发到独立 human 运行，且 planner 输出中不得混入系统收口用的总结任务

### Requirement: Plan runs MUST append synthesis human before completion
当运行进入计划路径时，main MUST 在业务任务结束后自动追加一个 synthesis human，用于汇总全部子任务交付并生成最终用户答复；该 synthesis 步骤 MUST 由 runtime 注入，而不是由 planner 负责规划。

#### Scenario: Synthesis follows completed business tasks
- **WHEN** 计划中的业务任务全部完成
- **THEN** main MUST 追加 synthesis human，再进入 run 完成收尾

#### Scenario: Synthesis is runtime-owned rather than planner-owned
- **WHEN** planner 输出业务任务列表
- **THEN** runtime MUST 将最终总结视为系统追加步骤，而不是要求 planner 把总结任务显式写进计划中

