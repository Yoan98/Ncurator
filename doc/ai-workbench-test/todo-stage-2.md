# AI Workbench 测试阶段 2 ToDo

## Current Goal

- 当前阶段聚焦 `backend/human`
- 目标是基于 `plan.md` 中的 `human` 阶段用例表，先落一批直接复用 Stage 1 `tools` 基线的 human case，验证 `human` 能自主调用工具并完成交付

## Done

- [x] 落地 `human-direct-kb-answer`
- [x] 落地 `human-direct-docx-edit`
- [x] 落地 `human-tool-failure-recovery`
- [x] 落地 `human-workspace-blocked-recovery`
- [x] 落地 `human-approval-blocked-recovery`
- [x] 落地 `human-terminal-docx-handoff`
- [x] 落地 `human-kb-docx-bridge`
- [x] 落地 `human-multi-source-merge-delivery`
- [x] 落地 `human-review-handoff-structured-delivery`
- [x] 落地 `human-evidence-insufficient-safe-stop`
- [x] 落地 `human-no-redundant-recheck`
- [x] 跑完当前 Stage 2 backend `human` 测试并刷新 `tests/logs/ai/backend/human/**`
- [x] 基于新 logs 更新 `tests/report/ai/report.md`

## In Progress

- [ ] 继续落地 `human-multi-turn-refinement`
- [ ] 继续落地 `human-long-task-project-brief`
- [ ] 继续落地 `human-partial-delivery-on-budget-limit`

## Blocked

- 当前无新增外部阻塞

## Evidence

- `doc/ai-workbench-test/plan.md`
- `tests/ai/backend/human/*.test.ts`
- `tests/logs/ai/backend/human/**`
- `tests/report/ai/report.md`

## Exit Criteria

- Stage 2 `human` 用例按计划持续落地，并优先覆盖 direct、failure recovery、blocked、bridge 这几类核心路径
- 新 backend raw logs 已持续产出到 `tests/logs/ai/backend/human/**`
- `tests/report/ai/report.md` 已基于最新 `human` logs 同步更新
- 当前阶段的 review-handoff、safe-stop 与 no-redundant 基线已经稳定后，再继续推进 refinement 与 long-task 收敛类 case
