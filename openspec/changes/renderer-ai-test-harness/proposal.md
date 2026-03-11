## Why

当前测试体系已经覆盖 Main/AI 侧的 `capability / runtime / human-live` 验证，并具备统一报告契约；Main/AI 用例现已迁移到 `tests/main/**`，renderer 与完整应用链路也已并列进入正式架构。需要继续保持目录、报告与脚本口径一致，避免旧的 `tests/ai/**` 语义残留。结果是：

- `ChatPage`、`ImportPage`、`SearchPage` 等关键交互只能靠人工回归；
- AI 无法基于 renderer 真实行为、截图、trace 与结构化结果完成闭环修复；
- 现有 `tests/report/**` 报告体系无法表达 UI 行为证据；
- 缺少按 `main / renderer / e2e` 组织的统一测试目录语言。

需要新增一套 renderer 测试能力，但仍保持以下原则不变：

- 统一由 `vitest` 编排；
- 报告继续落到 `tests/report/**`；
- 优先复用 preload/shared 契约，不在测试中复制业务协议；
- 将确定性回归与 AI 探索式测试分层，避免把不稳定 live 测试直接作为主门禁。

## What Changes

- 新增按 `main / renderer / e2e` 组织的测试目录方案，并明确：
  - `tests/main/**`：Main 进程/服务入口测试；
  - `tests/renderer/**`：页面/组件 contract 测试；
  - `tests/e2e/**`：真实 Electron 应用端到端测试。
- 在 `renderer` 与 `e2e` 侧补齐三类关键能力：
  - `renderer contract`：使用受控 `DesktopApi` stub 和事件脚本验证页面状态机与 IPC 交互；
  - `e2e deterministic`：启动真实 Electron 应用，验证 preload + renderer + main 的端到端交互；
  - `e2e ai-live`：在真实应用表面上执行 AI 探索式测试，用于非阻塞诊断与修复闭环。
- 明确技术选型：
  - `renderer` 使用 `Vitest + jsdom + React Testing Library + user-event`
  - `e2e` 与 `ai-live` 使用 `Playwright (Electron)`
- 扩展测试报告契约，使 renderer suite 也输出统一的 `events/assertions/metrics/signals/summary`，并允许附带截图、trace、console、DOM 快照等 UI 证据。
- 为 chat execution UI 增加可自动化约束：关键交互点、状态面板和阻塞交互必须具备稳定 automation selector 或等价可定位契约。
- 补充 `doc/testing.md` 与 `doc/project-structure.md`，使目录、suite 分类、命令、报告与 AI 使用方式保持一致。

## Capabilities

### New Capabilities

- `renderer-ui-test-suite`: 定义 renderer 的 `contract / e2e / ai-live` 三层测试能力、目录约束、运行方式与适用边界。

### Modified Capabilities

- `ai-test-reporting-contract`: 扩展现有测试报告契约，使 renderer suite 可复用统一报告并附带 UI 证据。
- `chat-execution-ui`: 增加关键交互面向自动化测试的稳定定位与可观测约束。

## Impact

- 影响代码范围：
  - `tests/main/**`
  - `tests/renderer/**`
  - `tests/e2e/**`
  - `tests/report/**`
  - 测试配置与脚本入口
  - renderer 若干关键页面与组件的测试可观测性改造
- 影响系统边界：
  - 不改变 Main/Renderer 的生产职责边界；
  - 允许测试 harness 以 preload 契约为中心组织 renderer stub 与 e2e 驱动；
  - `e2e ai-live` 默认作为非阻塞套件，不直接成为主 CI gate。
- 依赖与工具：
  - 保持 `vitest` 为统一执行入口；
  - 引入 Electron UI 驱动能力与 trace/screenshot 产物管理；
- Main/AI 测试统一落到 `tests/main/**`，renderer 与完整应用链路分别落到 `tests/renderer/**`、`tests/e2e/**`。
