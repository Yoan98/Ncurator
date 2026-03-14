# AI Current Summary

该文档基于当前已存在的 AI facts 与最新 `tests/report/ai/report.md` 更新。

## Current Status

- 当前 AI 测试新架构已可在 `backend/capability/terminal` 这一条样例上跑通。
- 原始日志、facts 文档和正式 report 的边界已经建立，Codex 后置分析流程已具备落点。
- 最新一次样例 run 为 `20260314-143053-465`，结果为 `passed`。

## Stable Points

- `pnpm test:ai:sample` 可以稳定执行单样例。
- `tests/logs/**` 能生成 `meta.json` 与 `timeline.jsonl`。
- `tests/report/ai/facts/**` 能生成对应 facts Markdown。
- terminal 基础成功路径当前可用。

## Unstable Points

- 当前只有一条 terminal 基础成功样例，覆盖面过窄。
- 还没有失败样例，因此缺少失败模式与优化方向的真实证据。
- `human`、`main-intent`、`main-context`、`main-plan`、`entire` 与 e2e 仍未进入新体系验证。

## Current Priority

1. 先补 terminal 的阻塞/失败样例。
2. 再补一条真实 AI 编排链路样例，优先 `human` 或 `main-context`。
3. backend 覆盖稳定后，再推进到 `ai/e2e/workbench`。

## Recent Changes

- 已移除旧测试体系、旧 catalog 和旧 report/analyzer 依赖。
- 已重建新的 tests 目录、统一 runner、raw logs 契约和 facts 文档。
- 已基于最新 run `20260314-143053-465` 刷新 `terminal-basic-command` 的正式 report 与 current summary。
