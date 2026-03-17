# AI Domain Report

该文档基于当前仓库内 `tests/logs/ai/**` 的现有 raw logs 更新。

## Domain Overview

- analysisWindow: `2026-03-17` 阶段 1 `backend/tools` + 阶段 2 当前 `backend/human` 最新批次 + 既有 `workbench` smoke
- analyzedScopes: `ai/backend/tools/docx`、`ai/backend/tools/terminal`、`ai/backend/tools/kb`、`ai/backend/human`、`ai/e2e/workbench`
- backendPassRate: 18/18 = 100.0%
- e2ePassRate: 2/2 = 100.0%
- overallAssessment: 阶段 1 `tool` 基线已闭环，阶段 2 `human` 已完成第一批基线样例；当前可以继续补阻塞后部分交付与双模型对比，而不是再回头补 tool 基础能力。

## Model Baseline

- primaryModel: `gpt-5-mini`
- strongModel: `gpt-5.2`
- runMode:
  - 阶段 1 `tool` 层 backend 维持 `single`
  - 阶段 2 起，`human` 关键样例、失败样例与 `golden cases` 进入 `pair`
- report-only fields:
  - `primaryModel`
  - `strongModel`
  - `runMode`
  - `primaryScore`
  - `strongScore`
- raw log constraint: 单次 run 仍然只通过 `meta.runtime.modelName` 记录真实执行模型，不修改 `meta.json / timeline.jsonl / artifacts.json` 固定契约

## backend

### tools

#### docx

##### Evidence

- `docx-open-outline-search` | passed | `tests/logs/ai/backend/tools/docx/docx-open-outline-search/20260317-114448-597/meta.json` | `tests/logs/ai/backend/tools/docx/docx-open-outline-search/20260317-114448-597/timeline.jsonl` | `tests/logs/ai/backend/tools/docx/docx-open-outline-search/20260317-114448-597/artifacts.json`
- `docx-mixed-edit-save-preview-validate` | passed | `tests/logs/ai/backend/tools/docx/docx-mixed-edit-save-preview-validate/20260317-114448-597/meta.json` | `tests/logs/ai/backend/tools/docx/docx-mixed-edit-save-preview-validate/20260317-114448-597/timeline.jsonl` | `tests/logs/ai/backend/tools/docx/docx-mixed-edit-save-preview-validate/20260317-114448-597/artifacts.json`
- `docx-history-rollback-errors` | passed | `tests/logs/ai/backend/tools/docx/docx-history-rollback-errors/20260317-114448-599/meta.json` | `tests/logs/ai/backend/tools/docx/docx-history-rollback-errors/20260317-114448-599/timeline.jsonl` | `tests/logs/ai/backend/tools/docx/docx-history-rollback-errors/20260317-114448-599/artifacts.json`
- `docx-save-overwrite-preview-boundaries` | passed | `tests/logs/ai/backend/tools/docx/docx-save-overwrite-preview-boundaries/20260317-114448-597/meta.json` | `tests/logs/ai/backend/tools/docx/docx-save-overwrite-preview-boundaries/20260317-114448-597/timeline.jsonl` | `tests/logs/ai/backend/tools/docx/docx-save-overwrite-preview-boundaries/20260317-114448-597/artifacts.json`

##### Pass Rate

- totalRuns: 4
- passedRuns: 4
- failedRuns: 0
- successRate: 100.0%

##### Current Assessment

- 已覆盖结构读取、文本搜索、混合编辑、保存、预览、校验、历史链、回滚、overwrite 边界。
- `docx` 当前已经不再只停留在单点 API happy path，而是具备阶段 1 所需的闭环能力基线。

#### terminal

##### Evidence

- `terminal-basic-command` | passed | `tests/logs/ai/backend/tools/terminal/terminal-basic-command/20260317-114448-441/meta.json` | `tests/logs/ai/backend/tools/terminal/terminal-basic-command/20260317-114448-441/timeline.jsonl` | `tests/logs/ai/backend/tools/terminal/terminal-basic-command/20260317-114448-441/artifacts.json`
- `terminal-artifact-approval` | passed | `tests/logs/ai/backend/tools/terminal/terminal-artifact-approval/20260317-114448-597/meta.json` | `tests/logs/ai/backend/tools/terminal/terminal-artifact-approval/20260317-114448-597/timeline.jsonl` | `tests/logs/ai/backend/tools/terminal/terminal-artifact-approval/20260317-114448-597/artifacts.json`
- `terminal-guardrails-and-failure` | passed | `tests/logs/ai/backend/tools/terminal/terminal-guardrails-and-failure/20260317-114448-597/meta.json` | `tests/logs/ai/backend/tools/terminal/terminal-guardrails-and-failure/20260317-114448-597/timeline.jsonl` | `tests/logs/ai/backend/tools/terminal/terminal-guardrails-and-failure/20260317-114448-597/artifacts.json`
- `terminal-read-and-cancel` | passed | `tests/logs/ai/backend/tools/terminal/terminal-read-and-cancel/20260317-114448-596/meta.json` | `tests/logs/ai/backend/tools/terminal/terminal-read-and-cancel/20260317-114448-596/timeline.jsonl` | `tests/logs/ai/backend/tools/terminal/terminal-read-and-cancel/20260317-114448-596/artifacts.json`
- `terminal-timeout-and-truncation` | passed | `tests/logs/ai/backend/tools/terminal/terminal-timeout-and-truncation/20260317-114448-597/meta.json` | `tests/logs/ai/backend/tools/terminal/terminal-timeout-and-truncation/20260317-114448-597/timeline.jsonl` | `tests/logs/ai/backend/tools/terminal/terminal-timeout-and-truncation/20260317-114448-597/artifacts.json`

##### Pass Rate

- totalRuns: 5
- passedRuns: 5
- failedRuns: 0
- successRate: 100.0%

##### Current Assessment

- 已覆盖读取工作区材料、多段命令、产物识别、边界拦截、审批通过、审批拒绝、失败、timeout、输出截断与取消分支。
- `terminal` 已经具备阶段 1 需要的事实事件链，后续重点会从 tool 本身转向 `human` 如何使用这些能力。

#### kb

##### Evidence

- `kb-search-modes-and-scope` | passed | `tests/logs/ai/backend/tools/kb/kb-search-modes-and-scope/20260317-114448-845/meta.json` | `tests/logs/ai/backend/tools/kb/kb-search-modes-and-scope/20260317-114448-845/timeline.jsonl` | `tests/logs/ai/backend/tools/kb/kb-search-modes-and-scope/20260317-114448-845/artifacts.json`
- `kb-list-documents` | passed | `tests/logs/ai/backend/tools/kb/kb-list-documents/20260317-114448-936/meta.json` | `tests/logs/ai/backend/tools/kb/kb-list-documents/20260317-114448-936/timeline.jsonl` | `tests/logs/ai/backend/tools/kb/kb-list-documents/20260317-114448-936/artifacts.json`
- `kb-fts-and-no-result` | passed | `tests/logs/ai/backend/tools/kb/kb-fts-and-no-result/20260317-114448-936/meta.json` | `tests/logs/ai/backend/tools/kb/kb-fts-and-no-result/20260317-114448-936/timeline.jsonl` | `tests/logs/ai/backend/tools/kb/kb-fts-and-no-result/20260317-114448-936/artifacts.json`

##### Pass Rate

- totalRuns: 3
- passedRuns: 3
- failedRuns: 0
- successRate: 100.0%

##### Current Assessment

- 已覆盖 `hybrid / vector / fts`、source scope 过滤、`list documents` 与无结果返回。
- `kb` 阶段 1 的重点已经从“能不能查”推进到“范围约束是否正确”，为下一阶段 `human` 引证和多工具串联打好了底。

### human

##### Evidence

- `human-single-step-kb-answer` | passed | `tests/logs/ai/backend/human/human-single-step-kb-answer/20260317-121622-021/meta.json` | `tests/logs/ai/backend/human/human-single-step-kb-answer/20260317-121622-021/timeline.jsonl` | `tests/logs/ai/backend/human/human-single-step-kb-answer/20260317-121622-021/artifacts.json`
- `human-blocked-on-workspace` | passed | `tests/logs/ai/backend/human/human-blocked-on-workspace/20260317-121622-205/meta.json` | `tests/logs/ai/backend/human/human-blocked-on-workspace/20260317-121622-205/timeline.jsonl` | `tests/logs/ai/backend/human/human-blocked-on-workspace/20260317-121622-205/artifacts.json`
- `human-approval-denied` | passed | `tests/logs/ai/backend/human/human-approval-denied/20260317-121622-084/meta.json` | `tests/logs/ai/backend/human/human-approval-denied/20260317-121622-084/timeline.jsonl` | `tests/logs/ai/backend/human/human-approval-denied/20260317-121622-084/artifacts.json`
- `human-self-correction-after-tool-failure` | passed | `tests/logs/ai/backend/human/human-self-correction-after-tool-failure/20260317-121621-152/meta.json` | `tests/logs/ai/backend/human/human-self-correction-after-tool-failure/20260317-121621-152/timeline.jsonl` | `tests/logs/ai/backend/human/human-self-correction-after-tool-failure/20260317-121621-152/artifacts.json`
- `human-docx-iterative-edit` | passed | `tests/logs/ai/backend/human/human-docx-iterative-edit/20260317-121621-157/meta.json` | `tests/logs/ai/backend/human/human-docx-iterative-edit/20260317-121621-157/timeline.jsonl` | `tests/logs/ai/backend/human/human-docx-iterative-edit/20260317-121621-157/artifacts.json`
- `human-terminal-docx-handoff` | passed | `tests/logs/ai/backend/human/human-terminal-docx-handoff/20260317-121621-158/meta.json` | `tests/logs/ai/backend/human/human-terminal-docx-handoff/20260317-121621-158/timeline.jsonl` | `tests/logs/ai/backend/human/human-terminal-docx-handoff/20260317-121621-158/artifacts.json`

##### Pass Rate

- totalRuns: 6
- passedRuns: 6
- failedRuns: 0
- successRate: 100.0%

##### Current Assessment

- 已覆盖单步闭环、多工具串联、`workspace_required` 阻塞、审批拒绝、阻塞后部分交付、失败纠偏和多轮 refinement。
- 当前 `human` 已经不是“只能单工具调通”，而是能在 backend 测试里验证关键事件链与任务收敛方向。
- 当前剩余缺口主要是双模型对比与阶段完成态整理，不再是基础链路缺失。

## e2e

### workbench

##### Evidence

- `20260314-153210-722` | passed | `tests/logs/ai/e2e/workbench/workbench-plan-artifact-smoke/20260314-153210-722/meta.json` | `tests/logs/ai/e2e/workbench/workbench-plan-artifact-smoke/20260314-153210-722/timeline.jsonl` | `tests/logs/ai/e2e/workbench/workbench-plan-artifact-smoke/20260314-153210-722/artifacts.json`
- `20260314-162218-992` | passed | `tests/logs/ai/e2e/workbench/workbench-plan-artifact-smoke/20260314-162218-992/meta.json` | `tests/logs/ai/e2e/workbench/workbench-plan-artifact-smoke/20260314-162218-992/timeline.jsonl` | `tests/logs/ai/e2e/workbench/workbench-plan-artifact-smoke/20260314-162218-992/artifacts.json`
- artifact references: `tests/logs/ai/e2e/workbench/workbench-plan-artifact-smoke/20260314-153210-722/artifacts/trace/playwright-trace.zip`、`tests/logs/ai/e2e/workbench/workbench-plan-artifact-smoke/20260314-162218-992/artifacts/trace/playwright-trace.zip`

##### Pass Rate

- totalRuns: 2
- passedRuns: 2
- failedRuns: 0
- successRate: 100.0%

##### Failure Analysis

- 当前已提交样例中没有 failed run，因此还不能判断 approval、workspace required、review 等真实用户路径的失败模式。
- e2e timeline 中的 route、IPC、AI event signal 已经为后续失败定位提供了足够事实锚点。

##### Current Assessment

- workbench smoke 主链路可用，且 trace artifact 已在新 schema 下保留。
- backend / e2e 都已经切到直接基于 raw logs 的分析方式。
- 当前不足是 e2e 仍只有 smoke 覆盖，场景深度不够。

## Stage Completion

- stage: `阶段 1 / tool`
- status: completed
- completedAt: `2026-03-17`
- nextStage: `阶段 2 / human`

## Current Progress

- activeStage: `阶段 2 / human`
- status: in progress
- completedHumanCases: `6`
- remainingFocus:
  - `primaryModel / strongModel` 对比跑法
  - 阶段 2 完成态报告与 `todo-stage-3`

## Next Stage Suggested Todolist

- `human-single-step-kb-answer`
- `human-docx-iterative-edit`
- `human-terminal-docx-handoff`
- `human-blocked-on-workspace`
- `human-self-correction-after-tool-failure`
- `human-multi-turn-refinement`
