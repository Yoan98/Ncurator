# AI Report

该文档基于 `tests/report/ai/facts/backend/capability/terminal/terminal-basic-command.md`、`tests/report/ai/facts/e2e/workbench/workbench-plan-artifact-smoke.md` 与对应 raw logs 更新。

## Overview

- scope: `ai/backend/capability/terminal` + `ai/e2e/workbench`
- analyzedCases: `terminal-basic-command`, `workbench-plan-artifact-smoke`
- latestBackendRunId: `20260314-152003-312`
- latestE2ERunId: `20260314-153210-722`
- currentAssessment: 当前原始日志契约下，backend sample 与 workbench e2e smoke 都能稳定产出 `meta.json`、`timeline.jsonl`、`artifacts.json`，其中 e2e 已验证 trace 附件链路。

## Success Rate

- totalRunsInFacts: 2
- passedRunsInFacts: 2
- failedRunsInFacts: 0
- successRate: 100.0%
- note: 当前正式 report 依据最新 facts 窗口；仓库内样例 raw logs 使用统一的 `meta.json`、`timeline.jsonl`、`artifacts.json` 结构，只保留最新通过样例。

## Failed Samples

- 本次 facts 窗口内没有 failed run。
- 当前失败模式仍然只存在调试过程中的本地临时 run，不纳入正式 facts 统计。

## Failure Analysis

- 当前没有失败样例，因此不能得出“失败原因”层面的结论。
- 从 backend raw logs 可以确认 terminal 基础成功链路已经覆盖 workspace boundary check、risk classification、terminal command execution。
- 从 e2e raw logs 可以确认 preload e2e 事件桥、语义 timeline、trace artifact 与 facts 汇总链路已经打通。
- 当前主要缺口不是契约设计，而是场景覆盖不足：还没有正式纳入 boundary rejection、approval denied、workspace required 等失败/阻塞样例。

## Success Samples

- backend 成功 run `20260314-152003-312` 先完成 workspace boundary check，再确认 risk classification 为 `low`，随后执行 terminal 命令并完成 `exitCode`、`timedOut`、`stdout` 断言。
- e2e 成功 run `20260314-153210-722` 已验证 workbench 页面加载、输入提交、AI 事件接收、时间线渲染，以及 trace 附件落盘。
- backend 与 e2e 两层都已进入 facts 闭环，说明当前 raw logs 已可供后续 Codex 分析直接消费。

## Optimization Decision

- needOptimization: yes
- optimizationFocus: 当前应优先补失败/阻塞 coverage，并让 e2e 覆盖更多真实工作台路径。
- reason: 契约与基础链路已通，但样例仍以成功路径为主，无法代表 AI 工作流在真实异常场景下的稳定性。

## Next Suggestions

1. 增加 terminal 的失败/阻塞样例，优先补 `workspace boundary`、`approval denied`、`invalid input`。
2. 在 `ai/e2e/workbench` 下继续补 `approval`、`workspace required`、`file artifact review` 等真实工作台路径。
3. 保持 raw logs 的 `message` 继续只写事实，不把分析逻辑回流到测试样例本身。
