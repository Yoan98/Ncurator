# AI Current Summary

该文档基于当前已存在的 AI facts 与最新 `tests/report/ai/report.md` 更新。

## Current Status

- 当前 AI 测试新架构已在 `backend/capability/terminal` 与 `e2e/workbench` 两条样例上跑通。
- 原始日志、facts 文档和正式 report 的边界已经建立，Codex 后置分析流程已具备落点。
- 最新 backend sample run 为 `20260314-152003-312`，最新 e2e smoke run 为 `20260314-153210-722`，结果均为 `passed`。

## Stable Points

- `pnpm test:ai:sample` 可以稳定执行单样例。
- `tests/logs/**` 能生成 `meta.json`、`timeline.jsonl` 与 `artifacts.json`。
- `tests/report/ai/facts/**` 能生成对应 facts Markdown。
- terminal 基础成功路径当前可用。
- workbench e2e smoke 当前可用，且已验证 trace 附件写盘。

## Unstable Points

- 当前 terminal 与 workbench 仍以成功样例为主，覆盖面偏窄。
- 正式 facts 里还没有失败样例，因此缺少失败模式与优化方向的正式证据。
- `human`、`main-intent`、`main-context`、`main-plan`、`entire` 仍未进入新体系验证。

## Current Priority

1. 先补 terminal 的阻塞/失败样例。
2. 再补 workbench 的审批、工作区、review 等 e2e 路径。
3. 然后补一条真实 AI 编排链路样例，优先 `human` 或 `main-context`。

## Recent Changes

- 当前测试体系使用统一 runner、统一 raw logs 契约和 facts 文档。
- 当前 e2e runtime、preload 事件桥和 workbench smoke case 已可用，并已验证 trace artifact 写盘。
- 当前 backend / e2e 样例与 facts、正式 report、current summary 保持一致。
