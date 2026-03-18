# AI Workbench 测试阶段 2 ToDo

## Current Goal

- 当前阶段聚焦 `backend/human`
- 目标是基于 `plan.md` 中的 `human` 阶段用例表，按 `basic / boundary / scenario / live` 四层组织单步闭环、多工具协作、阻塞收敛、长任务和 live 验证基线

## Done

- [x] 落地 `human-direct-kb-answer`
- [x] 落地 `human-direct-docx-edit`
- [x] 落地 `human-tool-failure-recovery`
- [x] 落地 `human-workspace-blocked-recovery`
- [x] 落地 `human-approval-blocked-recovery`
- [x] 落地 `human-evidence-insufficient-safe-stop`
- [x] 落地 `human-no-redundant-recheck`
- [x] 落地 `human-partial-delivery-on-budget-limit`
- [x] 落地 `human-terminal-docx-handoff`
- [x] 落地 `human-kb-docx-bridge`
- [x] 落地 `human-multi-source-merge-delivery`
- [x] 落地 `human-review-handoff-structured-delivery`
- [x] 落地 `human-multi-turn-refinement`
- [x] 落地 `human-long-task-project-brief`
- [x] 落地 `human-long-task-with-corrections`
- [x] 落地 `human-long-task-approval-branch`
- [x] 落地 `human-live-direct-docx-edit`
- [x] 落地 `human-live-terminal-docx-handoff`
- [x] 落地 `human-live-long-task-project-brief`

## In Progress

- [ ] 落地 `human-live-direct-kb-answer`
- [ ] 落地 `human-live-kb-docx-bridge`
- [ ] 落地 `human-live-evidence-insufficient-safe-stop`
- [ ] 跑完 Stage 2 backend/human 测试并刷新 `tests/logs/ai/**`
- [ ] 基于新的 human logs 更新 `tests/report/ai/report.md`

## Blocked

- 当前无新增外部阻塞
- `human` 阶段 live 结论仍不完整，Stage 2 尚不能仅凭 non-live case 视为完成

## Evidence

- `doc/ai-workbench-test/plan.md`
- `tests/ai/backend/human/{basic,boundary,scenario,live}/*.test.ts`
- `tests/logs/ai/backend/human/**`

## Exit Criteria

- Stage 2 的 `human` 用例按计划落到 `basic / boundary / scenario / live`
- `human` 阶段剩余 live case 已补齐
- 新的 backend/human raw logs 已产出到 `tests/logs/ai/**`
- `tests/report/ai/report.md` 已基于新的 human logs 更新
- 允许按计划创建下一阶段 `todo-stage-N.md`
