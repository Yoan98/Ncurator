## MODIFIED Requirements

### Requirement: Render explicit plan UI with progress
The chat UI MUST render a dedicated capability-based plan view showing planner tasks, current progress state, and the terminal synthesis phase, without any legacy writing-workflow stage visualization.

#### Scenario: Plan progress updates
- **WHEN** runtime emits business task lifecycle events and terminal synthesis progression
- **THEN** UI MUST update plan progress indicators and show active/completed/failed states for both business execution and final synthesis delivery

### Requirement: Support expandable step details
The plan UI MUST allow users to expand/collapse per-task details including task delivery markdown, tool/terminal traces, and outputs, using typed event payloads from the active architecture contracts.

#### Scenario: User expands completed plan task
- **WHEN** user opens a completed task in plan UI
- **THEN** UI MUST show该任务对应的交付文档、相关工具轨迹与关键输出，而不会丢失摘要可见性

### Requirement: Render retrieval and artifact panels
聊天执行界面的右侧工作区 MUST 提供可回溯的时间线与检查器，用于展示检索结果、文档片段、工具输出、任务交付文档、文件产物、草稿预览和最终提交结果，而不是只保留最新一次工具输出的覆盖式面板。

#### Scenario: 用户回看某个任务交付
- **WHEN** 用户在一次 plan 运行完成后切换到某个中间业务任务
- **THEN** 右侧检查器 MUST 展示该任务的交付 markdown 与关联证据，而不会被最终 synthesis 覆盖

#### Scenario: 产物与交付在检查器中可交互
- **WHEN** 某个任务同时生成了文件产物、草稿预览或交付文档
- **THEN** 右侧检查器 MUST 同时提供对应的查看入口，并明确区分任务交付、预览产物与最终提交产物

## ADDED Requirements

### Requirement: Chat 执行界面 MUST 支持 direct human 无计划运行
聊天执行界面 MUST 支持 direct human 路径下的无计划运行；当运行未创建 plan 而直接由 human 完成任务时，UI MUST 仍然展示执行叙事、最终答复与可回放的关键节点，而不是把该运行视为异常或空计划状态。

#### Scenario: Direct human run finishes without plan
- **WHEN** runtime 选择 direct human 路径并完成一次运行
- **THEN** UI MUST 正常展示 assistant 内容、活动叙事和相关检查器内容，而不要求必须存在 plan 卡片

### Requirement: Chat 执行界面 MUST 展示任务交付文档
聊天执行界面 MUST 将任务交付文档作为一等检查器内容展示，使用户可以查看 plan 中间任务的 handoff 文本与最终 synthesis 答复之间的关系。

#### Scenario: 用户查看中间任务 handoff
- **WHEN** 某个计划中的业务任务已生成交付文档
- **THEN** UI MUST 提供稳定入口查看该 handoff markdown，并允许用户在不同任务交付之间切换回看
