# ai-runner Specification

## Purpose
TBD - created by archiving change langgraph-chat-ai-architecture. Update Purpose after archive.
## Requirements
### Requirement: Orchestrate host-led loops with explicit capabilities
系统 MUST 以双层模型编排运行：`main graph` 负责系统阶段控制，`human graph` 负责单任务执行；运行时 MUST 继续使用能力节点（如 `local_kb_retrieval`、`terminal_exec`、`docx`）并排除 legacy writing-workflow 调度模型，同时 main 到 human 的任务派发契约 MUST 不再依赖 `mode` 字段。

#### Scenario: Main graph orchestrates system stages
- **WHEN** 新 run 启动
- **THEN** main graph MUST 按 `intent -> context_enrich -> plan -> main_plan_exec -> finalize` 阶段推进

#### Scenario: Human graph executes one task objective
- **WHEN** main graph 派发单个计划任务
- **THEN** human graph MUST 仅围绕该任务目标执行步骤循环，并以最小任务输入契约执行任务

#### Scenario: Legacy writing task shape appears
- **WHEN** 计划中出现 legacy writing-workflow 任务形态
- **THEN** runtime MUST 以不支持能力类型处理并拒绝调度

### Requirement: Let host choose direct response vs execution plan
系统 MUST 在 main 层完成“直接答复或生成执行计划”的分流决策，并在需要执行时将计划任务拆分为独立任务交给 human 执行；每个任务输入 MUST 为 `taskId + objective`。

#### Scenario: Direct answer path
- **WHEN** intent/context_enrich 判定无需执行动作
- **THEN** main MUST 直接进入 finalization 并输出最终答复

#### Scenario: Plan execution path
- **WHEN** 需要执行本地动作
- **THEN** main MUST 生成计划并逐个任务派发到独立 human 运行，且派发输入不包含任务模式字段

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

### Requirement: Host owns final response streaming
最终用户答复 MUST 在 main finalization 阶段统一收敛和流式输出，且不得由 capability 或 human 子步骤直接结束整个 run。

#### Scenario: Finalization after human tasks
- **WHEN** main 收到任务完成或阻塞后的汇总状态
- **THEN** 由 finalization 统一产出响应 token 与完成信号

### Requirement: Support cancellation and fail-fast routing
运行时 MUST 在 main/human 双层都支持取消与失败快速收敛，取消或不可恢复失败发生后 MUST 停止后续步骤和任务派发。

#### Scenario: Cancel during human step loop
- **WHEN** human 执行过程中收到取消信号
- **THEN** 当前步骤立即停止并上报取消，main 停止后续调度

#### Scenario: Unrecoverable task block
- **WHEN** human 返回不可恢复的 `block_task`
- **THEN** main 按失败收敛策略结束或终止 run，且不继续盲目推进后续步骤

### Requirement: Use centralized prompt registry in runtime orchestration
运行时 MUST 通过统一 prompt registry 生成 main/human/memory 相关提示词，核心节点 MUST NOT 继续以内联字符串维护主提示词内容。

#### Scenario: Main node prompt resolution
- **WHEN** main intent/plan/finalize 节点触发模型调用
- **THEN** 节点 MUST 从 prompt registry 解析对应提示词并构建请求

#### Scenario: Human and memory prompt resolution
- **WHEN** human brain 或会话记忆更新触发模型调用
- **THEN** 相关模块 MUST 复用 registry 提供的提示词构建入口，并共享统一约束文本风格

