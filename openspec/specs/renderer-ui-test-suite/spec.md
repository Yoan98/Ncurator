# renderer-ui-test-suite Specification

## Purpose
TBD - created by archiving change renderer-ai-test-harness. Update Purpose after archive.
## Requirements
### Requirement: 测试体系 MUST 提供 renderer contract、e2e deterministic、e2e ai-live 三层 UI 相关 suite

系统 MUST 为 UI 相关测试提供三层能力：`tests/renderer/**` 下的 contract 测试、`tests/e2e/**` 下的 deterministic 端到端测试，以及 `tests/e2e/**` 下的 ai-live 探索式测试；三者 MUST 共享统一报告契约，但职责边界 MUST 明确区分。

#### Scenario: 开发者运行 UI 相关测试

- **WHEN** 开发者执行 renderer 或 e2e 测试入口
- **THEN** 系统 MUST 能按 contract、deterministic e2e、ai-live e2e 分别运行对应 suite

#### Scenario: 为 renderer 新增一个测试

- **WHEN** 开发者希望新增 Chat 或 Import 页面测试
- **THEN** 新用例 MUST 能落在 `tests/renderer/**` 或 `tests/e2e/**` 的适当层级，而无需混入 `tests/ai/**`

### Requirement: Renderer contract 测试 MUST 使用类型安全的 preload API stub 与事件脚本

`tests/renderer/**` 下的 contract 测试 MUST 以 preload 暴露的 API 类型为唯一契约来源，使用受控 stub 与事件脚本验证页面状态机、交互反馈与 IPC 调用参数；该层 MUST NOT 要求真实 Electron 窗口启动。

#### Scenario: Chat 收到审批事件

- **WHEN** contract 测试向 Chat 页面注入 `approval_required` 事件
- **THEN** UI MUST 显示可操作审批交互，并将用户决策通过受控 `aiRunApprovalDecide` 调用发出

#### Scenario: Import 加载失败

- **WHEN** contract 测试令 `workspaceList` 或 `webSourceList` 返回失败
- **THEN** 页面 MUST 渲染对应错误反馈并保持可恢复的交互状态

### Requirement: E2E deterministic 测试 MUST 运行真实 Electron 链路并覆盖关键用户主流程

`tests/e2e/**/deterministic/**` 测试 MUST 启动真实 Electron 应用并通过真实 preload + renderer 验证关键用户流程；首批主流程 MUST 至少覆盖 Chat 计划与产物渲染、审批交互、工作区阻塞恢复，以及 Import/Search 的主链路。

#### Scenario: Chat 渲染一次完整运行

- **WHEN** e2e 测试在 Chat 页面触发一次 AI run
- **THEN** UI MUST 能显示计划、步骤、右侧输出面板与文件产物区域

#### Scenario: Chat 命中工作区阻塞

- **WHEN** 运行时发出 `workspace_required`
- **THEN** e2e 测试 MUST 能验证页面进入补充工作区流程并支持继续执行

### Requirement: E2E AI live 测试 MUST 为非阻塞诊断套件并输出可修复证据

`tests/e2e/**/ai-live/**` MUST 建立在真实应用表面之上，但默认 MUST 作为非阻塞诊断套件运行；其结果 MUST 输出足够的结构化信号与 UI 证据，供后续 AI 读取并完成修复回归。

#### Scenario: 本地触发 AI 探索式测试

- **WHEN** 开发者执行 e2e ai-live 用例
- **THEN** 系统 MUST 运行带目标约束的 UI 探索任务，并输出失败断言、截图、trace 与相关事件证据

#### Scenario: 主门禁运行确定性测试

- **WHEN** CI 或常规回归仅运行确定性 renderer 测试
- **THEN** e2e ai-live MUST NOT 成为必过门槛

### Requirement: UI 相关测试目录 MUST 独立于 `tests/ai/**` 并映射到 `tests/renderer/**` 与 `tests/e2e/**`

页面/组件 contract 测试 MUST 放在 `tests/renderer/**`；真实端到端测试 MUST 放在 `tests/e2e/**`；报告输出 MUST 继续归档到 `tests/report/<suite>/<case>/<timestamp>/`。

#### Scenario: 新增 renderer fixture

- **WHEN** 开发者添加事件脚本、工作区样例或 UI 状态种子
- **THEN** 这些输入 MUST 放入 `tests/fixtures/renderer/**` 或 `tests/fixtures/e2e/**`，而不是混入 `tests/ai/fixtures/**`

#### Scenario: UI 相关 suite 写入报告

- **WHEN** 任一 renderer contract、e2e deterministic 或 e2e ai-live 用例执行结束
- **THEN** 报告 MUST 写入与其 suite 命名一致的 `tests/report/**` 分组目录

