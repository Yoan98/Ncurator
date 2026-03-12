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
The chat UI MUST render a dedicated capability-based plan view showing plan steps, current step, and progress state, without any legacy writing-workflow stage visualization.

#### Scenario: Plan progress updates
- **WHEN** runtime emits plan and task lifecycle events
- **THEN** UI updates plan progress indicators and active/completed/failed step states in real time

### Requirement: Support expandable step details
The plan UI MUST allow users to expand/collapse per-step details including tool/terminal traces and outputs, using typed event payloads from active architecture contracts.

#### Scenario: User expands completed step
- **WHEN** user opens a completed step in plan UI
- **THEN** UI shows associated detailed traces without losing summary visibility

### Requirement: Support approval and workspace-required interaction events
The UI MUST render actionable prompts for approval-required and workspace-required events.

#### Scenario: Approval prompt shown
- **WHEN** runtime emits approval-required event
- **THEN** UI shows approve/deny actions and submits decision to runtime

### Requirement: Render retrieval and artifact panels
The right panel MUST show retrieval outputs and file artifact entries with open actions.

#### Scenario: Artifact interaction
- **WHEN** artifact events arrive
- **THEN** UI shows artifact links and supports open default/reveal/open-with actions with error feedback

### Requirement: Remove legacy writing entry points from chat execution surface
The chat execution surface MUST not expose legacy writing-workflow actions, buttons, or IPC-triggering affordances.

#### Scenario: Chat page renders execution controls
- **WHEN** user opens chat execution UI
- **THEN** only active capability-based controls are shown and no legacy writing workflow action is available

### Requirement: Chat 执行界面 MUST 暴露稳定的自动化定位契约

聊天执行界面的关键交互点与关键状态区域 MUST 暴露稳定的自动化定位契约，以支撑 renderer contract 与 renderer e2e 测试；这些定位契约 MUST 覆盖发送入口、计划区、审批交互、工作区阻塞交互、右侧输出面板与文件产物区。

#### Scenario: 自动化定位审批交互

- **WHEN** 测试运行时发出 `approval_required`
- **THEN** 自动化框架 MUST 能稳定定位审批提示、通过按钮与拒绝按钮，而不依赖脆弱的 AntD 内部 DOM 结构

#### Scenario: 自动化定位工作区阻塞交互

- **WHEN** 测试运行时发出 `workspace_required`
- **THEN** 自动化框架 MUST 能稳定定位补充工作区入口与继续执行入口

### Requirement: Chat 执行界面 MUST 对关键运行时状态提供确定性测试可观测性

聊天执行界面对计划、步骤、右侧输出面板和文件产物区的关键状态切换 MUST 具备确定性的测试可观测性，避免测试只能依赖模糊文案猜测界面状态。

#### Scenario: 计划与右侧面板更新

- **WHEN** 运行时依次发出计划事件、工具结果事件和文件产物事件
- **THEN** 自动化测试 MUST 能确定性判断计划区、右侧面板和产物区已经进入对应状态

#### Scenario: 运行失败后的错误可观测

- **WHEN** AI run 启动失败、取消失败或产物打开失败
- **THEN** 自动化测试 MUST 能确定性观察到对应错误反馈，而不是依赖不可预测的瞬时 UI 状态

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

