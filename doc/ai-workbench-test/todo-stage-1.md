# AI Workbench 测试阶段 1 ToDo

## Current Goal

- 当前阶段聚焦 `backend/tools`
- 目标是基于 `plan.md` 中新的 Stage 1 用例表，按 `基本调用`、`边界测试`、`真实任务链路` 三类视角重建 `docx`、`terminal`、`kb` 的测试基线，并显著扩宽 `tool` 覆盖面

## Done

- [ ] 待开始

## In Progress

- [ ] 落地 `T1-docx-structure-read`
- [ ] 落地 `T1-docx-block-targeting-and-ambiguous-search`
- [ ] 落地 `T1-docx-mixed-structural-edit`
- [ ] 落地 `T1-docx-table-and-inline-rewrite`
- [ ] 落地 `T1-docx-save-conflict-and-overwrite-policy`
- [ ] 落地 `T1-docx-preview-validate-rollback`
- [ ] 落地 `T1-terminal-workspace-material-discovery`
- [ ] 落地 `T1-terminal-relative-and-absolute-path-resolution`
- [ ] 落地 `T1-terminal-batch-material-summary`
- [ ] 落地 `T1-terminal-artifact-producing-command`
- [ ] 落地 `T1-terminal-approval-and-boundary`
- [ ] 落地 `T1-terminal-approval-denied-follow-up`
- [ ] 落地 `T1-terminal-failure-and-long-output`
- [ ] 落地 `T1-kb-hybrid-retrieval`
- [ ] 落地 `T1-kb-list-documents-and-scope-filter`
- [ ] 落地 `T1-kb-empty-scope-and-no-result`
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
- 允许按计划创建下一阶段 `todo-stage-N.md`
