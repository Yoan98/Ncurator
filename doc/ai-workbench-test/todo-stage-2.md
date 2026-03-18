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
- [x] 落地 `human-live-direct-kb-answer`
- [x] 落地 `human-live-evidence-insufficient-safe-stop`
- [x] 落地 `human-live-terminal-docx-handoff`
- [x] 落地 `human-live-kb-docx-bridge`
- [x] 落地 `human-live-long-task-project-brief`
- [x] 跑完 Stage 2 `backend/human` non-live 测试并刷新 `tests/logs/ai/backend/human/{basic,boundary,scenario}/**`

## In Progress

- [ ] 补跑 `human-live-long-task-project-brief` 并补齐 `tests/logs/ai/backend/human/live/**` raw log
- [x] 基于新的 human logs 更新 `tests/report/ai/report.md`

## Blocked

- 当前无新增外部阻塞
- `human-live-kb-docx-bridge` 已在 2026-03-18 的 primary `gpt-5` 最新补跑 `20260318-183145-326` 形成通过态交付
- `human-live-terminal-docx-handoff` 已在 2026-03-18 的 primary `gpt-5` 最新补跑 `20260318-183730-563` 形成通过态交付
- 当前剩余缺口不是外部阻塞，而是 `human-live-long-task-project-brief` 仍缺 raw log 证据

## Evidence

- `doc/ai-workbench-test/plan.md`
- `tests/ai/backend/human/{basic,boundary,scenario,live}/*.test.ts`
- `tests/logs/ai/backend/human/**`
- `tests/logs/ai/backend/human/live/human-live-direct-docx-edit/20260318-170540-431/*`
- `tests/logs/ai/backend/human/live/human-live-direct-kb-answer/20260318-155931-482/*`
- `tests/logs/ai/backend/human/live/human-live-evidence-insufficient-safe-stop/20260318-160515-299/*`
- `tests/logs/ai/backend/human/live/human-live-kb-docx-bridge/20260318-183145-326/*`
- `tests/logs/ai/backend/human/live/human-live-terminal-docx-handoff/20260318-183730-563/*`
- `tests/logs/ai/backend/human/live/human-live-kb-docx-bridge/20260318-150310-015/*`
- `tests/logs/ai/backend/human/live/human-live-kb-docx-bridge/20260318-150906-789/*`
- `tests/logs/ai/backend/human/live/human-live-kb-docx-bridge/20260318-151207-536/*`

## Exit Criteria

- Stage 2 的 `human` 用例按计划落到 `basic / boundary / scenario / live`
- `human` 阶段剩余 live case 已补齐
- 新的 backend/human raw logs 已产出到 `tests/logs/ai/**`
- `tests/report/ai/report.md` 已基于新的 human logs 更新
- 允许按计划创建下一阶段 `todo-stage-N.md`
