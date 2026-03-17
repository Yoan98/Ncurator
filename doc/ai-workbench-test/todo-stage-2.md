# AI Workbench 测试阶段 2 ToDo

## Current Goal

- 当前阶段聚焦 `backend/human`
- 目标是按 `基本调用`、`边界测试`、`实际场景` 三类视角建立 `human` 测试基线

## Done

- [ ] 待 Stage 1 完成后启动

## In Progress

- [ ] 补齐 `human` 的基础闭环用例
- [ ] 补齐 `human` 的阻塞、审批、失败纠偏用例
- [ ] 补齐 `human` 的真实任务场景用例
- [ ] 对 `primary` 稳定失败样例补跑一次 `strong` 诊断
- [ ] 跑完 Stage 2 backend 测试并刷新 `tests/logs/ai/**`
- [ ] 基于新 logs 更新 `tests/report/ai/report.md`

## Blocked

- 依赖 Stage 1 完成

## Evidence

- `doc/ai-workbench-test/plan.md`

## Exit Criteria

- Stage 2 的 `human` 用例已按新计划实现
- 新 backend raw logs 已产出到 `tests/logs/ai/**`
- `tests/report/ai/report.md` 已基于新 logs 更新
- 可以明确进入下一阶段
