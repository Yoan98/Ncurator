# chat-execution-ui Specification

## Purpose
TBD - created by archiving change langgraph-chat-ai-architecture. Update Purpose after archive.
## Requirements
### Requirement: Provide imported-document `@` targeting in chat
聊天 UI MUST 将 `@` 选择从“已导入文档”扩展为统一资料范围选择，并在发送运行请求时同时传递已准备文档标识与结构化范围信息，而不再仅发送文档 ID 列表；聊天 UI MUST 将该范围解释为“本次提问的优先参考资料范围”，而不是严格过滤条件。

#### Scenario: 输入 `@` 查看范围候选
- **WHEN** 用户在聊天输入框中输入 `@`
- **THEN** 候选列表 MUST 来自已配置的工作空间、目录、文件与网页资料，并支持用户选择多个范围项

### Requirement: Require workspace selection for executable runs
聊天 UI MUST 通过已配置工作空间的选择结果收集工作空间上下文，用于文件读取或终端执行类能力；当运行需要工作空间边界而当前没有可用工作空间上下文时，UI MUST 提示用户先选择或配置工作空间，而不是要求用户手动输入根路径。

#### Scenario: 范围内存在本地文件但没有工作空间上下文
- **WHEN** 用户发送的问题需要访问本地文件，且当前没有任何已配置或已选定的工作空间可以作为访问边界
- **THEN** UI MUST 提示用户先配置或选择工作空间后再继续运行

### Requirement: Show inline AI activity feed in assistant side
The chat UI MUST show a user-readable inline activity feed under assistant content describing what AI did (for example read docs, ran commands, created/deleted files).

#### Scenario: Inline activity visibility
- **WHEN** runtime emits activity events during execution
- **THEN** assistant-side UI displays ordered activity items with status and short summaries

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

### Requirement: Support approval and workspace-required interaction events
The UI MUST render actionable prompts for approval-required and workspace-required events.

#### Scenario: Approval prompt shown
- **WHEN** runtime emits approval-required event
- **THEN** UI shows approve/deny actions and submits decision to runtime

### Requirement: Render retrieval and artifact panels
聊天执行界面的右侧工作区 MUST 提供可回溯的时间线与检查器，用于展示检索结果、文档片段、工具输出、任务交付文档、文件产物、草稿预览和最终提交结果，而不是只保留最新一次工具输出的覆盖式面板。

#### Scenario: 用户回看某个任务交付
- **WHEN** 用户在一次 plan 运行完成后切换到某个中间业务任务
- **THEN** 右侧检查器 MUST 展示该任务的交付 markdown 与关联证据，而不会被最终 synthesis 覆盖

#### Scenario: 产物与交付在检查器中可交互
- **WHEN** 某个任务同时生成了文件产物、草稿预览或交付文档
- **THEN** 右侧检查器 MUST 同时提供对应的查看入口，并明确区分任务交付、预览产物与最终提交产物

### Requirement: Remove legacy writing entry points from chat execution surface
The chat execution surface MUST not expose legacy writing-workflow actions, buttons, or IPC-triggering affordances.

#### Scenario: Chat page renders execution controls
- **WHEN** user opens chat execution UI
- **THEN** only active capability-based controls are shown and no legacy writing workflow action is available

### Requirement: 聊天输入区明确提示 `@` 的参考语义
聊天 UI MUST 通过文案、提示或帮助信息向用户明确：`@` 用于告诉 AI 本次应优先参考哪些资料，而不是保证回答只来自这些资料。

#### Scenario: 用户查看 `@` 帮助信息
- **WHEN** 用户查看聊天输入区中与 `@` 范围相关的提示信息
- **THEN** UI MUST 使用非技术化表述说明该范围是 AI 的优先参考资料范围

### Requirement: 本地范围选择应自动提供对应工作空间上下文
聊天 UI MUST 在用户选择本地工作空间、目录或文件作为 `@` 范围时自动提供对应的工作空间上下文，用于后续本地文件读取或终端执行类能力，而不是要求用户重复完成同一工作空间选择。

#### Scenario: 选择本地文件后自动具备工作空间上下文
- **WHEN** 用户在聊天输入区通过 `@` 选择某个本地文件或目录
- **THEN** UI MUST 使该次运行自动携带该范围所属工作空间的上下文信息

### Requirement: 在聊天输入区展示未准备资料提示
聊天 UI MUST 在已选范围中明确区分未准备的本地文件或目录，并在合适位置提示这些范围可能导致 AI 直接读取原文件、耗时更长或增加 token 消耗。

#### Scenario: 已选范围包含未准备文件
- **WHEN** 用户已经在聊天输入区选择了一个未准备文件作为范围
- **THEN** UI MUST 在输入区附近展示该文件未准备的状态提示，并告知其可能增加处理成本

### Requirement: 聊天过程需要明确反馈本地资料使用情况
聊天 UI MUST 让用户明确感知本次回答或执行是否实际使用了本地资料；当 AI 主要依赖已选本地范围内的知识库内容或工作空间文件读取结果完成任务时，UI MUST 提供可理解的反馈。

#### Scenario: AI 使用了本地资料完成回答
- **WHEN** AI 基于已选本地范围内的知识库内容或工作空间文件内容完成回答
- **THEN** UI MUST 以可理解的方式提示本次回答已使用本地资料

### Requirement: 本地信息不足时需要明确询问是否允许使用非本地信息
聊天 UI MUST 将“本地信息不足，需要进一步使用非本地信息”的情况呈现为明确的用户决策点，而不是让 AI 默默继续；在用户作出同意前，UI MUST 维持当前运行的本地优先语义。

#### Scenario: AI 请求使用非本地信息继续
- **WHEN** AI 判断本地资料不足并发出继续使用非本地信息的请求
- **THEN** UI MUST 清晰展示该请求的原因，并允许用户决定是否继续使用非本地信息

#### Scenario: 用户未同意使用非本地信息
- **WHEN** AI 已请求使用非本地信息，但用户尚未明确同意
- **THEN** UI MUST 不将当前回答呈现为已基于非本地信息完成

### Requirement: 运行阻塞原因映射为结构化反馈
聊天 UI MUST 将与工作空间或范围相关的关键阻塞原因映射为结构化反馈，而不是仅展示笼统失败文案；至少包含：缺少工作空间边界、所选路径失效、范围不可用、审批被拒绝。

#### Scenario: 工作空间路径已失效导致运行阻塞
- **WHEN** 运行时发现当前选中的工作空间路径已失效，无法继续在该边界内访问本地资料
- **THEN** UI MUST 基于结构化错误原因展示对应提示，并引导用户重新选择、重新扫描或移除该工作空间

### Requirement: 统一会话工作台 MUST 同时承载 AI 对话与纯搜索模式
聊天执行界面 MUST 将 `AI 对话` 与 `纯搜索` 放在同一会话工作台中，用户在两种模式间切换时 MUST 保持同一会话上下文，而不是跳转到独立页面。

#### Scenario: 用户在同一会话中切换搜索与对话
- **WHEN** 用户在统一工作台中先执行一次纯搜索，再切换到 `AI 对话` 继续提问
- **THEN** 系统 MUST 在同一会话中保留这两个回合，而不是创建新的独立页面上下文

### Requirement: 纯搜索模式 MUST 以对话形式呈现且不依赖 LLM
聊天执行界面在 `纯搜索` 模式下 MUST 以对话回合形式展示检索请求与固定回复摘要，并 MUST 不依赖 LLM 配置或模型可用性。

#### Scenario: 未配置 LLM 时仍可执行纯搜索
- **WHEN** 用户未配置任何 LLM，但在统一工作台中切换到 `纯搜索` 模式并提交查询
- **THEN** 系统 MUST 正常返回本地检索结果与对话式摘要回复，而不会要求先配置模型

### Requirement: 编辑运行期间 MUST 不弹出逐块确认
聊天执行界面在 AI 编辑运行期间 MUST 只展示执行进展、步骤叙事和检查器内容，而 MUST NOT 在每次小块编辑完成后打断流程要求用户即时确认；若本次运行产生可提交修改，系统 MUST 在整次运行结束后再进入统一草稿审阅阶段。

#### Scenario: 多块编辑在运行中连续完成
- **WHEN** AI 在一次运行中连续完成多次文档块修改
- **THEN** UI MUST 持续展示执行进展，并在整次运行完成后才展示统一审阅入口

### Requirement: 右侧时间线 MUST 支持回溯查看历史步骤
统一工作台的右侧时间线 MUST 允许用户回溯查看前一步、后一步或任意已完成步骤的检查器内容，以便理解 AI 执行路径和证据链。

#### Scenario: 用户切换查看不同步骤
- **WHEN** 用户在同一回合中依次点击某个读取步骤、某个编辑步骤和最终提交步骤
- **THEN** 右侧检查器 MUST 分别展示对应步骤的详情，而不会丢失已完成步骤的可访问性

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
