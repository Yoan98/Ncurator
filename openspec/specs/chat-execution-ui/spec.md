# chat-execution-ui Specification

## Purpose
TBD - created by archiving change langgraph-chat-ai-architecture. Update Purpose after archive.
## Requirements
### Requirement: Provide imported-document `@` targeting in chat
The chat UI MUST provide `@` selection from imported documents and send selected ids with run input.

#### Scenario: Mention suggestions
- **WHEN** user types `@` in chat input
- **THEN** suggestions come from imported KB documents

### Requirement: Require workspace selection for executable runs
The chat UI MUST collect/select workspace context before starting runs that require terminal or file-execution capabilities, and MUST not fall back to legacy writing-workflow UI paths.

#### Scenario: Workspace missing on action request
- **WHEN** user sends prompt that requires execution and no workspace is selected
- **THEN** UI presents workspace selection flow before execution continues

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

