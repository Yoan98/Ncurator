# AI 域测试报告

## 总览

### 分析范围

- raw logs 范围: 当前仓库内 `tests/logs/ai/backend/tools/**`
- 已分析 scope: `ai/backend/tools/docx/basic`、`ai/backend/tools/docx/boundary`、`ai/backend/tools/docx/scenario`、`ai/backend/tools/terminal/basic`、`ai/backend/tools/terminal/boundary`、`ai/backend/tools/terminal/scenario`、`ai/backend/tools/kb/basic`、`ai/backend/tools/kb/boundary`
- 未纳入本次分析: Stage 2 `ai/backend/human/**` 与旧版 flat scope `ai/backend/tools/docx`、`ai/backend/tools/terminal`、`ai/backend/tools/kb`

### 总体结论

- 历史总数据: `40` 次 raw runs，其中 `40` 次 passed、`0` 次 failed，historicalSuccessRate=`100.0%`
- 最新总数据: `20 / 20` 个 case 的最新一轮 run 为 passed，latestSuccessRate=`100.0%`
- 当前结论: report 已重置为 Stage 1 `backend/tools` 口径，当前新的分层 scope 下 `docx / terminal / kb` 三组工具基线都已跑通。

### 下一阶段建议

- 先保持当前 Stage 1 `tools` 分层目录和命名稳定，继续把它作为后续 `human` / `entire` 的底层回归基线。

## backend

### tools

#### docx

##### 通过率

- 历史总数据:
  - totalRuns: 16
  - passedRuns: 16
  - failedRuns: 0
  - historicalSuccessRate: 100.0%
- 最新总数据:
  - latestCaseCount: 8
  - latestPassedCases: 8
  - latestFailedCases: 0
  - latestSuccessRate: 100.0%

##### 分层统计

- `basic`: `6` 次 raw runs，最新 `3 / 3 passed`
- `boundary`: `4` 次 raw runs，最新 `2 / 2 passed`
- `scenario`: `6` 次 raw runs，最新 `3 / 3 passed`

##### 最新证据

- `tool-docx-search-modes-and-scope` | `20260318-131740-749` | passed | `tests/logs/ai/backend/tools/docx/basic/tool-docx-search-modes-and-scope/20260318-131740-749/meta.json` | `tests/logs/ai/backend/tools/docx/basic/tool-docx-search-modes-and-scope/20260318-131740-749/timeline.jsonl` | `tests/logs/ai/backend/tools/docx/basic/tool-docx-search-modes-and-scope/20260318-131740-749/artifacts.json`
- `tool-docx-structure-read` | `20260318-131740-748` | passed | `tests/logs/ai/backend/tools/docx/basic/tool-docx-structure-read/20260318-131740-748/meta.json` | `tests/logs/ai/backend/tools/docx/basic/tool-docx-structure-read/20260318-131740-748/timeline.jsonl` | `tests/logs/ai/backend/tools/docx/basic/tool-docx-structure-read/20260318-131740-748/artifacts.json`
- `tool-docx-targeting-and-ambiguous-search` | `20260318-131740-749` | passed | `tests/logs/ai/backend/tools/docx/basic/tool-docx-targeting-and-ambiguous-search/20260318-131740-749/meta.json` | `tests/logs/ai/backend/tools/docx/basic/tool-docx-targeting-and-ambiguous-search/20260318-131740-749/timeline.jsonl` | `tests/logs/ai/backend/tools/docx/basic/tool-docx-targeting-and-ambiguous-search/20260318-131740-749/artifacts.json`
- `tool-docx-preview-validate-rollback` | `20260318-131740-749` | passed | `tests/logs/ai/backend/tools/docx/boundary/tool-docx-preview-validate-rollback/20260318-131740-749/meta.json` | `tests/logs/ai/backend/tools/docx/boundary/tool-docx-preview-validate-rollback/20260318-131740-749/timeline.jsonl` | `tests/logs/ai/backend/tools/docx/boundary/tool-docx-preview-validate-rollback/20260318-131740-749/artifacts.json`
- `tool-docx-save-conflict-and-overwrite` | `20260318-131740-749` | passed | `tests/logs/ai/backend/tools/docx/boundary/tool-docx-save-conflict-and-overwrite/20260318-131740-749/meta.json` | `tests/logs/ai/backend/tools/docx/boundary/tool-docx-save-conflict-and-overwrite/20260318-131740-749/timeline.jsonl` | `tests/logs/ai/backend/tools/docx/boundary/tool-docx-save-conflict-and-overwrite/20260318-131740-749/artifacts.json`
- `tool-docx-mixed-structural-edit` | `20260318-131740-763` | passed | `tests/logs/ai/backend/tools/docx/scenario/tool-docx-mixed-structural-edit/20260318-131740-763/meta.json` | `tests/logs/ai/backend/tools/docx/scenario/tool-docx-mixed-structural-edit/20260318-131740-763/timeline.jsonl` | `tests/logs/ai/backend/tools/docx/scenario/tool-docx-mixed-structural-edit/20260318-131740-763/artifacts.json`
- `tool-docx-multi-document-session-isolation` | `20260318-131740-749` | passed | `tests/logs/ai/backend/tools/docx/scenario/tool-docx-multi-document-session-isolation/20260318-131740-749/meta.json` | `tests/logs/ai/backend/tools/docx/scenario/tool-docx-multi-document-session-isolation/20260318-131740-749/timeline.jsonl` | `tests/logs/ai/backend/tools/docx/scenario/tool-docx-multi-document-session-isolation/20260318-131740-749/artifacts.json`
- `tool-docx-table-and-inline-rewrite` | `20260318-131740-770` | passed | `tests/logs/ai/backend/tools/docx/scenario/tool-docx-table-and-inline-rewrite/20260318-131740-770/meta.json` | `tests/logs/ai/backend/tools/docx/scenario/tool-docx-table-and-inline-rewrite/20260318-131740-770/timeline.jsonl` | `tests/logs/ai/backend/tools/docx/scenario/tool-docx-table-and-inline-rewrite/20260318-131740-770/artifacts.json`

##### 失败分析

- 当前 Stage 1 分层 analysis window 内没有 failed run。

##### 当前评估

- `docx` 已完整覆盖 Stage 1 计划中的 `basic / boundary / scenario` 三层目标，且当前最新口径为 `8 / 8 passed`。

#### terminal

##### 通过率

- 历史总数据:
  - totalRuns: 14
  - passedRuns: 14
  - failedRuns: 0
  - historicalSuccessRate: 100.0%
- 最新总数据:
  - latestCaseCount: 7
  - latestPassedCases: 7
  - latestFailedCases: 0
  - latestSuccessRate: 100.0%

##### 分层统计

- `basic`: `4` 次 raw runs，最新 `2 / 2 passed`
- `boundary`: `6` 次 raw runs，最新 `3 / 3 passed`
- `scenario`: `4` 次 raw runs，最新 `2 / 2 passed`

##### 最新证据

- `tool-terminal-path-resolution` | `20260318-131741-370` | passed | `tests/logs/ai/backend/tools/terminal/basic/tool-terminal-path-resolution/20260318-131741-370/meta.json` | `tests/logs/ai/backend/tools/terminal/basic/tool-terminal-path-resolution/20260318-131741-370/timeline.jsonl` | `tests/logs/ai/backend/tools/terminal/basic/tool-terminal-path-resolution/20260318-131741-370/artifacts.json`
- `tool-terminal-workspace-material-discovery` | `20260318-131741-389` | passed | `tests/logs/ai/backend/tools/terminal/basic/tool-terminal-workspace-material-discovery/20260318-131741-389/meta.json` | `tests/logs/ai/backend/tools/terminal/basic/tool-terminal-workspace-material-discovery/20260318-131741-389/timeline.jsonl` | `tests/logs/ai/backend/tools/terminal/basic/tool-terminal-workspace-material-discovery/20260318-131741-389/artifacts.json`
- `tool-terminal-approval-and-boundary` | `20260318-131741-430` | passed | `tests/logs/ai/backend/tools/terminal/boundary/tool-terminal-approval-and-boundary/20260318-131741-430/meta.json` | `tests/logs/ai/backend/tools/terminal/boundary/tool-terminal-approval-and-boundary/20260318-131741-430/timeline.jsonl` | `tests/logs/ai/backend/tools/terminal/boundary/tool-terminal-approval-and-boundary/20260318-131741-430/artifacts.json`
- `tool-terminal-approval-denied-follow-up` | `20260318-131741-505` | passed | `tests/logs/ai/backend/tools/terminal/boundary/tool-terminal-approval-denied-follow-up/20260318-131741-505/meta.json` | `tests/logs/ai/backend/tools/terminal/boundary/tool-terminal-approval-denied-follow-up/20260318-131741-505/timeline.jsonl` | `tests/logs/ai/backend/tools/terminal/boundary/tool-terminal-approval-denied-follow-up/20260318-131741-505/artifacts.json`
- `tool-terminal-failure-and-long-output` | `20260318-131740-773` | passed | `tests/logs/ai/backend/tools/terminal/boundary/tool-terminal-failure-and-long-output/20260318-131740-773/meta.json` | `tests/logs/ai/backend/tools/terminal/boundary/tool-terminal-failure-and-long-output/20260318-131740-773/timeline.jsonl` | `tests/logs/ai/backend/tools/terminal/boundary/tool-terminal-failure-and-long-output/20260318-131740-773/artifacts.json`
- `tool-terminal-artifact-producing-command` | `20260318-131741-439` | passed | `tests/logs/ai/backend/tools/terminal/scenario/tool-terminal-artifact-producing-command/20260318-131741-439/meta.json` | `tests/logs/ai/backend/tools/terminal/scenario/tool-terminal-artifact-producing-command/20260318-131741-439/timeline.jsonl` | `tests/logs/ai/backend/tools/terminal/scenario/tool-terminal-artifact-producing-command/20260318-131741-439/artifacts.json`
- `tool-terminal-batch-material-summary` | `20260318-131741-439` | passed | `tests/logs/ai/backend/tools/terminal/scenario/tool-terminal-batch-material-summary/20260318-131741-439/meta.json` | `tests/logs/ai/backend/tools/terminal/scenario/tool-terminal-batch-material-summary/20260318-131741-439/timeline.jsonl` | `tests/logs/ai/backend/tools/terminal/scenario/tool-terminal-batch-material-summary/20260318-131741-439/artifacts.json`

##### 失败分析

- 当前 Stage 1 分层 analysis window 内没有 failed run。

##### 当前评估

- `terminal` 已覆盖材料发现、路径解析、审批边界、失败收敛和产物识别三层目标，且当前最新口径为 `7 / 7 passed`。

#### kb

##### 通过率

- 历史总数据:
  - totalRuns: 10
  - passedRuns: 10
  - failedRuns: 0
  - historicalSuccessRate: 100.0%
- 最新总数据:
  - latestCaseCount: 5
  - latestPassedCases: 5
  - latestFailedCases: 0
  - latestSuccessRate: 100.0%

##### 分层统计

- `basic`: `8` 次 raw runs，最新 `4 / 4 passed`
- `boundary`: `2` 次 raw runs，最新 `1 / 1 passed`

##### 最新证据

- `tool-kb-fts-search` | `20260318-131741-574` | passed | `tests/logs/ai/backend/tools/kb/basic/tool-kb-fts-search/20260318-131741-574/meta.json` | `tests/logs/ai/backend/tools/kb/basic/tool-kb-fts-search/20260318-131741-574/timeline.jsonl` | `tests/logs/ai/backend/tools/kb/basic/tool-kb-fts-search/20260318-131741-574/artifacts.json`
- `tool-kb-hybrid-search` | `20260318-131741-664` | passed | `tests/logs/ai/backend/tools/kb/basic/tool-kb-hybrid-search/20260318-131741-664/meta.json` | `tests/logs/ai/backend/tools/kb/basic/tool-kb-hybrid-search/20260318-131741-664/timeline.jsonl` | `tests/logs/ai/backend/tools/kb/basic/tool-kb-hybrid-search/20260318-131741-664/artifacts.json`
- `tool-kb-list-documents-and-scope-filter` | `20260318-131741-814` | passed | `tests/logs/ai/backend/tools/kb/basic/tool-kb-list-documents-and-scope-filter/20260318-131741-814/meta.json` | `tests/logs/ai/backend/tools/kb/basic/tool-kb-list-documents-and-scope-filter/20260318-131741-814/timeline.jsonl` | `tests/logs/ai/backend/tools/kb/basic/tool-kb-list-documents-and-scope-filter/20260318-131741-814/artifacts.json`
- `tool-kb-vector-search` | `20260318-131741-823` | passed | `tests/logs/ai/backend/tools/kb/basic/tool-kb-vector-search/20260318-131741-823/meta.json` | `tests/logs/ai/backend/tools/kb/basic/tool-kb-vector-search/20260318-131741-823/timeline.jsonl` | `tests/logs/ai/backend/tools/kb/basic/tool-kb-vector-search/20260318-131741-823/artifacts.json`
- `tool-kb-empty-scope-and-no-result` | `20260318-131741-542` | passed | `tests/logs/ai/backend/tools/kb/boundary/tool-kb-empty-scope-and-no-result/20260318-131741-542/meta.json` | `tests/logs/ai/backend/tools/kb/boundary/tool-kb-empty-scope-and-no-result/20260318-131741-542/timeline.jsonl` | `tests/logs/ai/backend/tools/kb/boundary/tool-kb-empty-scope-and-no-result/20260318-131741-542/artifacts.json`

##### 失败分析

- 当前 Stage 1 分层 analysis window 内没有 failed run。

##### 当前评估

- `kb` 已覆盖 `hybrid / vector / fts / list_documents` 与 `empty scope / no-result`，且当前最新口径为 `5 / 5 passed`。
