# AI Workbench 测试阶段 1 ToDo

## Current Goal

- 当前阶段聚焦 `backend/tools`
- 目标是按 `基本调用`、`边界测试`、`实际场景` 三类视角重新建立 `docx`、`terminal`、`kb` 的测试基线

## Done

- [x] `plan.md` 已按阶段补齐 Stage 1 用例清单
- [x] 阶段文档口径已收敛为纯 todolist
- [x] `report.md` 已重置为等待新基线结果

## In Progress

- [ ] 重新设计并落地 `docx` 的三类视角测试
- [ ] 重新设计并落地 `terminal` 的三类视角测试
- [ ] 重新设计并落地 `kb` 的三类视角测试
- [ ] 跑完 Stage 1 backend 测试并刷新 `tests/logs/ai/**`
- [ ] 基于新 logs 更新 `tests/report/ai/report.md`

## Blocked

- 当前无新增外部阻塞

## Evidence

- `doc/ai-workbench-test/plan.md`
- `tests/report/ai/report.md`

## Exit Criteria

- Stage 1 的 `tools` 用例已按新计划实现
- 新 backend raw logs 已产出到 `tests/logs/ai/**`
- `tests/report/ai/report.md` 已基于新 logs 更新
- 可以明确进入 `todo-stage-2.md`
