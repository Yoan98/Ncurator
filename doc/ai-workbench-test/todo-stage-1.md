# AI Workbench 测试阶段 1 ToDo

## Current Goal

- 当前阶段聚焦 `backend/tools`
- 目标是基于 `plan.md` 中新的 `tool` 阶段用例表，并按 `test.md` 中的测试用例设计准则组织 `docx`、`terminal`、`kb` 的测试基线

## Done

- [x] 落地 `tool-docx-structure-read`
- [x] 落地 `tool-docx-targeting-and-ambiguous-search`
- [x] 落地 `tool-docx-search-modes-and-scope`
- [x] 落地 `tool-docx-mixed-structural-edit`
- [x] 落地 `tool-docx-table-and-inline-rewrite`
- [x] 落地 `tool-docx-save-conflict-and-overwrite`
- [x] 落地 `tool-docx-preview-validate-rollback`
- [x] 落地 `tool-docx-multi-document-session-isolation`
- [x] 落地 `tool-terminal-workspace-material-discovery`
- [x] 落地 `tool-terminal-path-resolution`
- [x] 落地 `tool-terminal-batch-material-summary`
- [x] 落地 `tool-terminal-artifact-producing-command`
- [x] 落地 `tool-terminal-approval-and-boundary`
- [x] 落地 `tool-terminal-approval-denied-follow-up`
- [x] 落地 `tool-terminal-failure-and-long-output`
- [x] 落地 `tool-kb-hybrid-search`
- [x] 落地 `tool-kb-vector-search`
- [x] 落地 `tool-kb-fts-search`
- [x] 落地 `tool-kb-list-documents-and-scope-filter`
- [x] 落地 `tool-kb-empty-scope-and-no-result`
- [x] 跑完 Stage 1 backend 测试并刷新 `tests/logs/ai/**`
- [x] 基于新 logs 更新 `tests/report/ai/report.md`

## In Progress

- [x] 已创建 `todo-stage-2.md`

## Blocked

- 当前无新增外部阻塞

## Evidence

- `doc/ai-workbench-test/plan.md`
- `tests/report/ai/report.md`
- `tests/logs/ai/backend/tools/**`

## Exit Criteria

- Stage 1 的 `tools` 用例已按新计划实现
- 新 backend raw logs 已产出到 `tests/logs/ai/**`
- `tests/report/ai/report.md` 已基于新 logs 更新
- 允许按计划创建下一阶段 `todo-stage-N.md`
