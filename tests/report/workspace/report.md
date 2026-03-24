# Workspace 测试报告

## 当前状态

- `workspace` 正式域当前已具备 10 条 backend case 和 5 条 e2e case。
- 2026-03-24 的最近一轮正式回归结果为：
  - backend：10 / 10 通过
  - e2e：5 / 5 通过
- `Settings -> Workspace` 主入口、网页资料管理、source scope 联动、工作空间扫描/准备和相关 backend/IPC 基线均已进入正式覆盖。

## 说明

- 本报告只汇总 `tests/logs/workspace/**` 下的正式运行结果。
- 具体用例定义以 [workspace-test.md](/Users/test/work-space/NCurator-Desktop/doc/test-plan/workspace-test.md) 为准。

## 最近通过记录

- backend 最近通过批次：
  - `workspace/backend/**` 于 2026-03-24 17:57 对应 run 批次全部通过。
  - 代表性最新 run：
    - `workspace-ipc-create-list-delete`：`20260324-175731-740`
    - `workspace-ipc-scan-and-nodes`：`20260324-175731-843`
    - `workspace-source-scope-bindings-and-warnings`：`20260324-175731-829`
- e2e 最近通过批次：
  - `settings-workspace-tab-only-entry`：`20260324-180029-639`
  - `settings-workspace-empty-and-error-state`：`20260324-180037-353`
  - `settings-web-source-management`：`20260324-180025-086`
  - `settings-workspace-create-scan-prepare-flow`：`20260324-180032-582`
  - `workspace-source-scope-bindings-and-warnings`：`20260324-180041-629`

## 已解决问题

- `settings-web-source-management`
  - 早期 run 因网页资料过滤输入框定位不稳定失败；现已改为基于 placeholder 的稳定交互，最近两次 run 均通过。
- `workspace-source-scope-bindings-and-warnings`
  - 早期 run 因 source scope 下拉未在重新打开时刷新最新 workspace 数据而失败；现已在聚焦时主动刷新范围选项，并通过更稳的 e2e 选择逻辑回归。

## 环境注意事项

- 当前桌面 harness 中，Workspace e2e 需要直接用 shell 命令执行：
  1. `pnpm exec electron-vite build`
  2. `pnpm exec vitest --config vitest.e2e.config.mts run tests/workspace/e2e`
- 通过额外的 `npm run` 或二次 shell wrapper 包装同一条 e2e 命令时，可能在 `electron.launch` 前触发环境相关的 `SIGABRT`；这属于执行环境问题，不影响最近直连 shell run 的通过结论。
