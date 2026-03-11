## ADDED Requirements

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
