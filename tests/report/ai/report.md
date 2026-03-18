# AI 域测试报告

## 总览

### 分析范围

- raw logs 范围: 当前仓库内 `tests/logs/ai/backend/tools/**`、`tests/logs/ai/backend/human/**`
- 已分析 scope: `ai/backend/tools/docx/basic`、`ai/backend/tools/docx/boundary`、`ai/backend/tools/docx/scenario`、`ai/backend/tools/terminal/basic`、`ai/backend/tools/terminal/boundary`、`ai/backend/tools/terminal/scenario`、`ai/backend/tools/kb/basic`、`ai/backend/tools/kb/boundary`、`ai/backend/human/basic`、`ai/backend/human/boundary`、`ai/backend/human/scenario`、`ai/backend/human/live`
- 说明: 当前 `ai/backend/human/live` analysis window 只包含本轮补跑并已落日志的 `human-live-direct-kb-answer`、`human-live-evidence-insufficient-safe-stop`、`human-live-kb-docx-bridge`；此前已实现的 `human-live-direct-docx-edit`、`human-live-terminal-docx-handoff`、`human-live-long-task-project-brief` 未在本轮重跑，因此不计入当前 `human/live` 的 latestCaseCount
- 未纳入本次分析: 旧版 flat scope `ai/backend/tools/docx`、`ai/backend/tools/terminal`、`ai/backend/tools/kb`

### 总体结论

- 历史总数据: `168` 次 raw runs，其中 `147` 次 passed、`21` 次 failed，historicalSuccessRate=`87.5%`
- 最新总数据: `39` 个 case 中有 `38` 个 case 的最新一轮 run 为 passed，latestSuccessRate=`97.4%`
- 当前结论: Stage 1 `backend/tools` 仍保持 `20 / 20 latest passed`；Stage 2 `backend/human` 的 `basic / boundary / scenario` 最新口径为 `16 / 16 passed`，但当前 `live` analysis window 仅 `2 / 3 passed`，`human-live-kb-docx-bridge` 仍未形成稳定 live 交付。
- 解释: `historicalSuccessRate` 已包含 2026-03-18 为诊断 `human-live-kb-docx-bridge` 所做的多轮 live 补跑，因此阶段判断应优先看 latest 口径，而不是把这些诊断性失败等同于稳定回归失败。

### 下一阶段建议

- 保持当前 Stage 1 `tools` 分层目录和 Stage 2 `human` non-live 基线稳定。
- 下一步优先修复 `human-live-kb-docx-bridge` 的 live 收敛与跨工具 handoff，再补跑本轮未覆盖的其他 `human live` case，之后再进入 `context` 阶段。

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

##### 证据

- `tool-docx-search-modes-and-scope` | run=`20260318-131740-749` | status=`passed`
- `tool-docx-structure-read` | run=`20260318-131740-748` | status=`passed`
- `tool-docx-targeting-and-ambiguous-search` | run=`20260318-131740-749` | status=`passed`
- `tool-docx-preview-validate-rollback` | run=`20260318-131740-749` | status=`passed`
- `tool-docx-save-conflict-and-overwrite` | run=`20260318-131740-749` | status=`passed`
- `tool-docx-mixed-structural-edit` | run=`20260318-131740-763` | status=`passed`
- `tool-docx-multi-document-session-isolation` | run=`20260318-131740-749` | status=`passed`
- `tool-docx-table-and-inline-rewrite` | run=`20260318-131740-770` | status=`passed`

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

##### 证据

- `tool-terminal-path-resolution` | run=`20260318-131741-370` | status=`passed`
- `tool-terminal-workspace-material-discovery` | run=`20260318-131741-389` | status=`passed`
- `tool-terminal-approval-and-boundary` | run=`20260318-131741-430` | status=`passed`
- `tool-terminal-approval-denied-follow-up` | run=`20260318-131741-505` | status=`passed`
- `tool-terminal-failure-and-long-output` | run=`20260318-131740-773` | status=`passed`
- `tool-terminal-artifact-producing-command` | run=`20260318-131741-439` | status=`passed`
- `tool-terminal-batch-material-summary` | run=`20260318-131741-439` | status=`passed`

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

##### 证据

- `tool-kb-fts-search` | run=`20260318-131741-574` | status=`passed`
- `tool-kb-hybrid-search` | run=`20260318-131741-664` | status=`passed`
- `tool-kb-list-documents-and-scope-filter` | run=`20260318-131741-814` | status=`passed`
- `tool-kb-vector-search` | run=`20260318-131741-823` | status=`passed`
- `tool-kb-empty-scope-and-no-result` | run=`20260318-131741-542` | status=`passed`

##### 失败分析

- 当前 Stage 1 分层 analysis window 内没有 failed run。

##### 当前评估

- `kb` 已覆盖 `hybrid / vector / fts / list_documents` 与 `empty scope / no-result`，且当前最新口径为 `5 / 5 passed`。

### human

##### 通过率

- 历史总数据:
  - totalRuns: 128
  - passedRuns: 107
  - failedRuns: 21
  - historicalSuccessRate: 83.6%
- 最新总数据:
  - latestCaseCount: 19
  - latestPassedCases: 18
  - latestFailedCases: 1
  - latestSuccessRate: 94.7%

##### 分层统计

- `basic`: `8` 次 raw runs，最新 `2 / 2 passed`
- `boundary`: `24` 次 raw runs，最新 `6 / 6 passed`
- `scenario`: `33` 次 raw runs，最新 `8 / 8 passed`
- `live`: `11` 次 raw runs，最新 `2 / 3 passed`

##### 证据

- `human-direct-docx-edit` | run=`20260318-151550-605` | status=`passed`
- `human-direct-kb-answer` | run=`20260318-151551-706` | status=`passed`
- `human-approval-blocked-recovery` | run=`20260318-151551-755` | status=`passed`
- `human-evidence-insufficient-safe-stop` | run=`20260318-151551-710` | status=`passed`
- `human-no-redundant-recheck` | run=`20260318-151551-803` | status=`passed`
- `human-partial-delivery-on-budget-limit` | run=`20260318-151551-723` | status=`passed`
- `human-tool-failure-recovery` | run=`20260318-151550-618` | status=`passed`
- `human-workspace-blocked-recovery` | run=`20260318-151551-679` | status=`passed`
- `human-kb-docx-bridge` | run=`20260318-151550-641` | status=`passed`
- `human-long-task-approval-branch` | run=`20260318-151551-710` | status=`passed`
- `human-long-task-project-brief` | run=`20260318-151550-604` | status=`passed`
- `human-long-task-with-corrections` | run=`20260318-151550-604` | status=`passed`
- `human-multi-source-merge-delivery` | run=`20260318-151550-604` | status=`passed`
- `human-multi-turn-refinement` | run=`20260318-151550-605` | status=`passed`
- `human-review-handoff-structured-delivery` | run=`20260318-151550-605` | status=`passed`
- `human-terminal-docx-handoff` | run=`20260318-151550-606` | status=`passed`
- `human-live-direct-kb-answer` | run=`20260318-145113-697` | status=`passed`
- `human-live-evidence-insufficient-safe-stop` | run=`20260318-150735-678` | status=`passed`
- `human-live-kb-docx-bridge` | run=`20260318-151207-536` | status=`failed`

##### 失败分析

- 当前 latest 口径下唯一 failed case 是 `human-live-kb-docx-bridge`。
- 2026-03-18 的 primary `gpt-5` 最新诊断 run `20260318-150310-015` 返回 `invalid_input`，summary=`524 status code (no body)`，事件只留下两次 `kb_hybrid_search_chunks`，说明链路在 live 模型侧已出现上游不稳定。
- 2026-03-18 的 stronger `gpt-5.2` 诊断 run `20260318-150906-789` 没有触发 524，但在 `kb_hybrid_search_chunks -> kb_list_documents` 后直接判定步数不足，未进入 `docx-editing` handoff。
- 2026-03-18 的更收敛 objective 诊断 run `20260318-151207-536` 仍然失败，表现为 `bounded_loop_error`，工具轨迹错误转入四次 `terminal_run_command` 加一次 `kb_hybrid_search_chunks`，没有产出 preview artifact。
- 因此，当前 bridge 失败同时暴露两类问题：一是 primary live 服务侧不稳定；二是 human 在 `KB -> DOCX` 这类跨工具任务上的 live 路由和收敛仍不稳定。

##### 当前评估

- `basic / boundary / scenario` 当前 latest 全通过，说明 Stage 2 的脚本化回归基线已经稳定。
- 新增补齐的 `human-live-direct-kb-answer` 与 `human-live-evidence-insufficient-safe-stop` 已形成 live 正向证据，其中前者还促成了 `KB` 收敛提示和 `localSourceStatus` 判定逻辑的修正。
- 当前 `human/live` latestCaseCount 只有 `3`，因为本轮没有重跑此前已实现的 `human-live-direct-docx-edit`、`human-live-terminal-docx-handoff`、`human-live-long-task-project-brief`；因此 Stage 2 live 结论目前仍只能算“部分补齐 + 明确暴露 bridge 缺口”。
- 在 `human-live-kb-docx-bridge` 稳定前，不建议把 Stage 2 视为可关闭阶段。
