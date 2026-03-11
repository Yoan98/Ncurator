## 1. 测试目录与执行入口

- [x] 1.1 新增 `tests/main`、`tests/renderer`、`tests/e2e` 目标目录骨架
- [x] 1.2 新增 renderer contract 的 Vitest 配置，以及 e2e deterministic / e2e ai-live 的 Playwright 运行入口与命令
- [x] 1.3 约定新的 `tests/report/**` 分组命名，与 `main / renderer / e2e` 顶层结构保持一致

## 2. Renderer Contract Harness

- [x] 2.1 引入并配置 `Vitest + jsdom + React Testing Library + @testing-library/user-event`
- [x] 2.2 建立基于 preload `DesktopApi` 的类型安全 stub 工厂，禁止复制 IPC 契约定义
- [x] 2.3 建立事件脚本回放器，用于重放 `AiRunEvent`、source list refresh、download progress 等 renderer 关心的事件
- [x] 2.4 建立页面挂载辅助工具，支持 HashRouter 路由、全局 message/notification 与受控初始状态
- [x] 2.5 建立 selector 常量层，统一关键交互点的稳定定位约束

## 3. Chat Renderer Contract 用例

- [x] 3.1 为 Chat 页面补齐关键 automation selector
- [x] 3.2 增加 Chat 右侧面板事件映射测试，覆盖 retrieval / tool output / terminal / artifact
- [x] 3.3 增加 Chat 审批交互测试，覆盖 `approval_required -> approve/deny -> aiRunApprovalDecide`
- [x] 3.4 增加 Chat 工作区阻塞测试，覆盖 `workspace_required` 的补充交互与继续执行入口

## 4. Renderer E2E Harness 与首批关键链路

- [x] 4.1 引入并配置 `Playwright (Electron)`，建立真实 Electron 启动器、窗口获取、trace/screenshot 收集与失败附件保存机制
- [x] 4.2 在 `tests/e2e/chat/deterministic/**` 增加 Chat `plan + artifact` 渲染 e2e
- [x] 4.3 在 `tests/e2e/chat/deterministic/**` 增加 Chat `approval_required` e2e
- [x] 4.4 在 `tests/e2e/chat/deterministic/**` 增加 Chat `workspace_required` e2e
- [x] 4.5 在 `tests/e2e/import/deterministic/**` 增加 Import `workspace create / scan / prepare` e2e
- [x] 4.6 在 `tests/e2e/search/deterministic/**` 增加 Search `source scope selection + results` e2e

## 5. E2E AI Live

- [x] 5.1 建立 `tests/e2e/*/ai-live/**` 执行约束，明确其为非阻塞 suite
- [x] 5.2 为 Chat 增加首个 AI 探索式任务用例，验证审批或工作区恢复链路
- [x] 5.3 为 AI live 报告补充 UI 证据索引与任务目标字段，便于后续自动修复

## 6. 报告契约与 AI 消费

- [x] 6.1 扩展测试报告契约，使 renderer suite 继续输出 `events/assertions/metrics/signals/summary`
- [x] 6.2 增加 renderer suite 可选附件：`screenshots`、`trace.zip`、`console.jsonl`、`dom snapshot`
- [x] 6.3 为 `signals.json` 增加 renderer 可选信号字段，如 `routeSequence`、`userActionSequence`、`ipcInvokeSequence`、`selectorFailures`
- [x] 6.4 明确 AI 消费 renderer 报告的最小输入集合和推荐修复流程

## 7. 文档与规范同步

- [x] 7.1 更新 `doc/testing.md`，加入 `main / renderer / e2e` 分层、命令、目录与报告说明
- [x] 7.2 更新 `doc/project-structure.md`，补充 `tests/main/**`、`tests/renderer/**`、`tests/e2e/**` 的放置规则
- [x] 7.3 将原 `tests/**` README 内容统一收敛到 `doc/testing.md`，避免多份文档漂移

## 8. 验证策略

- [x] 8.1 验证 renderer contract 用例在无真实 Electron 下可稳定复现关键状态流转
- [x] 8.2 验证 e2e deterministic 用例可在真实 Electron 下稳定产出报告与 UI 附件
- [x] 8.3 验证 e2e ai-live 缺少 live 前置时能够按约定 fail-fast 或 skip，不污染主门禁
- [x] 8.4 验证失败用例的报告足以支撑 AI 读取结果并执行一次定向修复回归
