# AI Workbench 测试阶段 2 ToDo

## Current Goal

- 当前阶段聚焦 `backend/human`
- 目标是基于 `plan.md` 中的 `human` 阶段用例表，先建立 `basic / boundary / scenario` contract 基线，再补 `live` 基线，避免只用脚本化 case 判断 `human` 能力成立

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
- [x] 将 `tests/ai/backend/human/**` 重排为 `basic / boundary / scenario / live`
- [x] 落地首批 `human/live` baseline：`human-live-direct-docx-edit`、`human-live-terminal-docx-handoff`、`human-live-long-task-project-brief`

## In Progress

- [ ] 继续落地 `human-multi-turn-refinement`
- [ ] 继续补齐 `human/live` 对应覆盖，尤其是 KB 与安全收敛路径
- [ ] 继续落地 `human-long-task-project-brief` 的 contract/非 live 基线
- [ ] 继续落地 `human-partial-delivery-on-budget-limit`
- [ ] 基于新 scope 刷新 `tests/report/ai/report.md`

## Blocked

- 当前无新增外部阻塞

## Evidence

- `doc/ai-workbench-test/plan.md`
- `tests/ai/backend/human/{basic,boundary,scenario,live}/*.test.ts`
- `tests/logs/ai/backend/human/**`
- `tests/report/ai/report.md`

## Exit Criteria

- Stage 2 `human` 用例按计划持续落地，且 `basic / boundary / scenario / live` 四类基线都已形成稳定目录与样例
- 新 backend raw logs 已持续产出到 `tests/logs/ai/backend/human/**`
- `tests/report/ai/report.md` 已能区分非 live 与 live 证据口径
- 当前阶段在 direct、blocked、handoff、bridge、merge 等 contract 基线稳定后，还需补出能支撑结论的 live 基线，再继续推进 refinement 与 long-task 收敛类 case
