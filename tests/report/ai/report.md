# AI 域测试报告

## 总览

### 分析范围

- raw logs 范围: 当前仓库内 `tests/logs/ai/backend/tools/**`、`tests/logs/ai/backend/human/**`
- 已分析 scope: `ai/backend/tools/docx/basic`、`ai/backend/tools/docx/boundary`、`ai/backend/tools/docx/scenario`、`ai/backend/tools/terminal/basic`、`ai/backend/tools/terminal/boundary`、`ai/backend/tools/terminal/scenario`、`ai/backend/tools/kb/basic`、`ai/backend/tools/kb/boundary`、`ai/backend/tools/kb/scenario`、`ai/backend/human/basic`、`ai/backend/human/boundary`、`ai/backend/human/scenario`、`ai/backend/human/live`
- 说明: 当前 `ai/backend/human/live` analysis window 包含仓库内已存在 raw log 的 `human-live-direct-docx-edit`、`human-live-direct-kb-answer`、`human-live-evidence-insufficient-safe-stop`、`human-live-kb-docx-bridge`、`human-live-terminal-docx-handoff`；`human-live-long-task-project-brief` 虽已实现测试文件，但当前 `tests/logs/ai/backend/human/live` 下没有对应 raw log，因此不计入当前 `human/live` 的 latestCaseCount
- 未纳入本次分析: 旧版 flat scope `ai/backend/tools/docx`、`ai/backend/tools/terminal`、`ai/backend/tools/kb`

### 总体结论

- 历史总数据: `180` 次 raw runs，其中 `165` 次 passed、`15` 次 failed，historicalSuccessRate=`91.7%`
- 最新总数据: `42` 个 case 中有 `42` 个 case 的最新一轮 run 为 passed，latestSuccessRate=`100.0%`
- 当前结论: Stage 1 `backend/tools` 已形成 `21 / 21 latest passed` 的三层基线；Stage 2 `backend/human` 的 `basic / boundary / scenario` 最新口径为 `16 / 16 passed`，当前 `live` analysis window 也已经达到 `5 / 5 passed`，其中 `human-live-kb-docx-bridge` 在 2026-03-18 的最新 `gpt-5` 补跑中已形成稳定通过态。
- 解释: `historicalSuccessRate` 仍包含 2026-03-18 为诊断 `human-live-kb-docx-bridge` 所做的多轮 live 失败 run，因此阶段判断应优先看 latest 口径，同时把这些历史失败保留为诊断证据。

### 下一阶段建议

- 保持当前 Stage 1 `tools` 三层目录和 Stage 2 `human` non-live 基线稳定。
- 下一步优先补跑 `human-live-long-task-project-brief` 并落 raw log，补齐第 6 条 `human/live` 证据；完成后即可更有把握进入 `context` 阶段。

## backend

### tools

#### docx

##### 通过率

- 历史总数据:
  - totalRuns: 24
  - passedRuns: 24
  - failedRuns: 0
  - historicalSuccessRate: 100.0%
- 最新总数据:
  - latestCaseCount: 8
  - latestPassedCases: 8
  - latestFailedCases: 0
  - latestSuccessRate: 100.0%

##### 分层统计

- `basic`: `9` 次 raw runs，最新 `3 / 3 passed`
- `boundary`: `6` 次 raw runs，最新 `2 / 2 passed`
- `scenario`: `9` 次 raw runs，最新 `3 / 3 passed`

##### 证据

- `tool-docx-search-modes-and-scope` | run=`20260318-164200-630` | status=`passed`
- `tool-docx-structure-read` | run=`20260318-164200-631` | status=`passed`
- `tool-docx-targeting-and-ambiguous-search` | run=`20260318-164200-633` | status=`passed`
- `tool-docx-preview-validate-rollback` | run=`20260318-164200-631` | status=`passed`
- `tool-docx-save-conflict-and-overwrite` | run=`20260318-164201-623` | status=`passed`
- `tool-docx-mixed-structural-edit` | run=`20260318-164200-637` | status=`passed`
- `tool-docx-multi-document-session-isolation` | run=`20260318-164200-631` | status=`passed`
- `tool-docx-table-and-inline-rewrite` | run=`20260318-164200-635` | status=`passed`

##### 失败分析

- 当前 Stage 1 分层 analysis window 内没有 failed run。

##### 当前评估

- `docx` 已完整覆盖 Stage 1 计划中的 `basic / boundary / scenario` 三层目标，且当前最新口径为 `8 / 8 passed`。

#### terminal

##### 通过率

- 历史总数据:
  - totalRuns: 21
  - passedRuns: 21
  - failedRuns: 0
  - historicalSuccessRate: 100.0%
- 最新总数据:
  - latestCaseCount: 7
  - latestPassedCases: 7
  - latestFailedCases: 0
  - latestSuccessRate: 100.0%

##### 分层统计

- `basic`: `6` 次 raw runs，最新 `2 / 2 passed`
- `boundary`: `9` 次 raw runs，最新 `3 / 3 passed`
- `scenario`: `6` 次 raw runs，最新 `2 / 2 passed`

##### 证据

- `tool-terminal-path-resolution` | run=`20260318-164201-600` | status=`passed`
- `tool-terminal-workspace-material-discovery` | run=`20260318-164201-623` | status=`passed`
- `tool-terminal-approval-and-boundary` | run=`20260318-164201-720` | status=`passed`
- `tool-terminal-approval-denied-follow-up` | run=`20260318-164201-601` | status=`passed`
- `tool-terminal-failure-and-long-output` | run=`20260318-164200-632` | status=`passed`
- `tool-terminal-artifact-producing-command` | run=`20260318-164201-848` | status=`passed`
- `tool-terminal-batch-material-summary` | run=`20260318-164201-205` | status=`passed`

##### 失败分析

- 当前 Stage 1 分层 analysis window 内没有 failed run。

##### 当前评估

- `terminal` 已覆盖材料发现、路径解析、审批边界、失败收敛和产物识别三层目标，且当前最新口径为 `7 / 7 passed`。

#### kb

##### 通过率

- 历史总数据:
  - totalRuns: 16
  - passedRuns: 16
  - failedRuns: 0
  - historicalSuccessRate: 100.0%
- 最新总数据:
  - latestCaseCount: 6
  - latestPassedCases: 6
  - latestFailedCases: 0
  - latestSuccessRate: 100.0%

##### 分层统计

- `basic`: `12` 次 raw runs，最新 `4 / 4 passed`
- `boundary`: `3` 次 raw runs，最新 `1 / 1 passed`
- `scenario`: `1` 次 raw runs，最新 `1 / 1 passed`

##### 证据

- `tool-kb-fts-search` | run=`20260318-164202-127` | status=`passed`
- `tool-kb-hybrid-search` | run=`20260318-164202-075` | status=`passed`
- `tool-kb-list-documents-and-scope-filter` | run=`20260318-164201-878` | status=`passed`
- `tool-kb-vector-search` | run=`20260318-164202-101` | status=`passed`
- `tool-kb-empty-scope-and-no-result` | run=`20260318-164201-983` | status=`passed`
- `tool-kb-document-discovery-to-targeted-search` | run=`20260318-164200-643` | status=`passed`

##### 失败分析

- 当前 Stage 1 分层 analysis window 内没有 failed run。

##### 当前评估

- `kb` 已覆盖 `hybrid / vector / fts / list_documents`、`empty scope / no-result`，以及“先发现文档、再定向检索、再精确确认”的 scenario 链路，且当前最新口径为 `6 / 6 passed`。

### human

##### 通过率

- 历史总数据:
  - totalRuns: 119
  - passedRuns: 104
  - failedRuns: 15
  - historicalSuccessRate: 87.4%
- 最新总数据:
  - latestCaseCount: 21
  - latestPassedCases: 21
  - latestFailedCases: 0
  - latestSuccessRate: 100.0%

##### 分层统计

- `basic`: `14` 次 raw runs，最新 `2 / 2 passed`
- `boundary`: `37` 次 raw runs，最新 `6 / 6 passed`
- `scenario`: `46` 次 raw runs，最新 `8 / 8 passed`
- `live`: `22` 次 raw runs，最新 `5 / 5 passed`

##### 证据

- `human-direct-docx-edit` | run=`20260318-182758-938` | status=`passed`
- `human-direct-kb-answer` | run=`20260318-155902-184` | status=`passed`
- `human-approval-blocked-recovery` | run=`20260318-182806-634` | status=`passed`
- `human-evidence-insufficient-safe-stop` | run=`20260318-155902-197` | status=`passed`
- `human-no-redundant-recheck` | run=`20260318-182758-937` | status=`passed`
- `human-partial-delivery-on-budget-limit` | run=`20260318-155902-188` | status=`passed`
- `human-tool-failure-recovery` | run=`20260318-182806-635` | status=`passed`
- `human-workspace-blocked-recovery` | run=`20260318-182806-634` | status=`passed`
- `human-kb-docx-bridge` | run=`20260318-182758-936` | status=`passed`
- `human-long-task-approval-branch` | run=`20260318-155902-137` | status=`passed`
- `human-long-task-project-brief` | run=`20260318-155901-487` | status=`passed`
- `human-long-task-with-corrections` | run=`20260318-155901-487` | status=`passed`
- `human-multi-source-merge-delivery` | run=`20260318-155901-484` | status=`passed`
- `human-multi-turn-refinement` | run=`20260318-155901-486` | status=`passed`
- `human-review-handoff-structured-delivery` | run=`20260318-155901-487` | status=`passed`
- `human-terminal-docx-handoff` | run=`20260318-155901-486` | status=`passed`
- `human-live-direct-docx-edit` | run=`20260318-170540-431` | status=`passed`
- `human-live-direct-kb-answer` | run=`20260318-155931-482` | status=`passed`
- `human-live-evidence-insufficient-safe-stop` | run=`20260318-160515-299` | status=`passed`
- `human-live-kb-docx-bridge` | run=`20260318-183145-326` | status=`passed`
- `human-live-terminal-docx-handoff` | run=`20260318-183730-563` | status=`passed`

##### 失败分析

- 2026-03-18 的 primary `gpt-5` 最新诊断 run `20260318-150310-015` 返回 `invalid_input`，summary=`524 status code (no body)`，事件只留下两次 `kb_hybrid_search_chunks`，说明链路在 live 模型侧已出现上游不稳定。
- 2026-03-18 的 stronger `gpt-5.2` 诊断 run `20260318-150906-789` 没有触发 524，但在 `kb_hybrid_search_chunks -> kb_list_documents` 后直接判定步数不足，未进入 `docx-editing` handoff。
- 2026-03-18 的更收敛 objective 诊断 run `20260318-151207-536` 仍然失败，表现为 `bounded_loop_error`，工具轨迹错误转入四次 `terminal_run_command` 加一次 `kb_hybrid_search_chunks`，没有产出 preview artifact。
- 2026-03-18 的最新 primary `gpt-5` 补跑 `20260318-183145-326` 已通过，工具链路收敛为一次 `kb_hybrid_search_chunks`、一次 `docx_open`、一次 `docx_apply_ops`，并在 preview 阶段最多发生一次 `docx_render_preview` 回退；没有再走 `kb_list_documents` 或 `terminal_run_command`。
- 2026-03-18 的最新 primary `gpt-5` `human-live-terminal-docx-handoff` 补跑 `20260318-183730-563` 也已通过，主链路收敛为 `terminal_run_command -> docx_open -> docx_apply_ops`，随后在 PDF preview 不可用时自动追加一次 HTML preview 回退。

##### 当前评估

- `basic / boundary / scenario` 当前 latest 全通过，说明 Stage 2 的脚本化回归基线已经稳定。
- 当前 5 条有 raw log 的 `human/live` case 最新口径全部通过，说明 `direct docx`、`direct kb`、`evidence insufficient`、`KB -> DOCX`、`terminal -> DOCX` 这几条核心 live 路径都已具备正向证据。
- 最新两条补跑尤其关键：`human-live-kb-docx-bridge` 与 `human-live-terminal-docx-handoff` 都表现出更短、更专注的工具序列，说明近期对 `human` prompt、tool spec 和运行态状态收口的调整已经开始反映到 live 执行质量上。
- 当前 Stage 2 剩余的证据缺口不是 latest failure，而是 `human-live-long-task-project-brief` 还没有 raw log；若要按计划表把第 6 条 live case 也补齐，还需要再跑一轮该 case。
