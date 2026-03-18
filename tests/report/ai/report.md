# AI 域测试报告

## 总览

### 分析范围

- raw logs 范围: 当前仓库内 `tests/logs/ai/**`
- 已分析 scope: `ai/backend/tools/docx`、`ai/backend/tools/terminal`、`ai/backend/tools/kb`、`ai/backend/human`

### 总体结论

- 历史总数据: `132` 次 raw runs，其中 `118` 次 passed、`14` 次 failed，historicalSuccessRate=`89.4%`
- 最新总数据: `31 / 31` 个 case 的最新一轮 run 为 passed，latestSuccessRate=`100.0%`
- 当前结论: Stage 1 `backend/tools` 已形成完整 raw logs 基线；Stage 2 `backend/human` 已补齐 direct / recovery / blocked / handoff / bridge / merge / review-handoff / safe-stop / no-redundant 九类基线，当前主要剩余 refinement 与 long-task 类 case。

### 下一阶段建议

- 继续推进 `backend/human`，优先补齐 `human-multi-turn-refinement`，再进入 `human-long-task-project-brief`
- 先保持当前 review-ready / safe-stop / no-redundant 基线稳定回归，再考虑进入 `context` / `intent` / `plan` 阶段

## backend

### tools

#### docx

##### 证据

- `20260317-192415-227` | passed | `tests/logs/ai/backend/tools/docx/tool-docx-mixed-structural-edit/20260317-192415-227/meta.json` | `tests/logs/ai/backend/tools/docx/tool-docx-mixed-structural-edit/20260317-192415-227/timeline.jsonl` | `tests/logs/ai/backend/tools/docx/tool-docx-mixed-structural-edit/20260317-192415-227/artifacts.json`
- `20260317-192415-233` | passed | `tests/logs/ai/backend/tools/docx/tool-docx-multi-document-session-isolation/20260317-192415-233/meta.json` | `tests/logs/ai/backend/tools/docx/tool-docx-multi-document-session-isolation/20260317-192415-233/timeline.jsonl` | `tests/logs/ai/backend/tools/docx/tool-docx-multi-document-session-isolation/20260317-192415-233/artifacts.json`
- `20260317-192415-189` | passed | `tests/logs/ai/backend/tools/docx/tool-docx-preview-validate-rollback/20260317-192415-189/meta.json` | `tests/logs/ai/backend/tools/docx/tool-docx-preview-validate-rollback/20260317-192415-189/timeline.jsonl` | `tests/logs/ai/backend/tools/docx/tool-docx-preview-validate-rollback/20260317-192415-189/artifacts.json`
- `20260317-192415-222` | passed | `tests/logs/ai/backend/tools/docx/tool-docx-save-conflict-and-overwrite/20260317-192415-222/meta.json` | `tests/logs/ai/backend/tools/docx/tool-docx-save-conflict-and-overwrite/20260317-192415-222/timeline.jsonl` | `tests/logs/ai/backend/tools/docx/tool-docx-save-conflict-and-overwrite/20260317-192415-222/artifacts.json`
- `20260317-192415-190` | passed | `tests/logs/ai/backend/tools/docx/tool-docx-search-modes-and-scope/20260317-192415-190/meta.json` | `tests/logs/ai/backend/tools/docx/tool-docx-search-modes-and-scope/20260317-192415-190/timeline.jsonl` | `tests/logs/ai/backend/tools/docx/tool-docx-search-modes-and-scope/20260317-192415-190/artifacts.json`
- `20260317-192415-229` | passed | `tests/logs/ai/backend/tools/docx/tool-docx-structure-read/20260317-192415-229/meta.json` | `tests/logs/ai/backend/tools/docx/tool-docx-structure-read/20260317-192415-229/timeline.jsonl` | `tests/logs/ai/backend/tools/docx/tool-docx-structure-read/20260317-192415-229/artifacts.json`
- `20260317-192415-204` | passed | `tests/logs/ai/backend/tools/docx/tool-docx-table-and-inline-rewrite/20260317-192415-204/meta.json` | `tests/logs/ai/backend/tools/docx/tool-docx-table-and-inline-rewrite/20260317-192415-204/timeline.jsonl` | `tests/logs/ai/backend/tools/docx/tool-docx-table-and-inline-rewrite/20260317-192415-204/artifacts.json`
- `20260317-192415-196` | passed | `tests/logs/ai/backend/tools/docx/tool-docx-targeting-and-ambiguous-search/20260317-192415-196/meta.json` | `tests/logs/ai/backend/tools/docx/tool-docx-targeting-and-ambiguous-search/20260317-192415-196/timeline.jsonl` | `tests/logs/ai/backend/tools/docx/tool-docx-targeting-and-ambiguous-search/20260317-192415-196/artifacts.json`
- `20260317-192153-234` | failed | `tests/logs/ai/backend/tools/docx/tool-docx-search-modes-and-scope/20260317-192153-234/meta.json` | `tests/logs/ai/backend/tools/docx/tool-docx-search-modes-and-scope/20260317-192153-234/timeline.jsonl` | `tests/logs/ai/backend/tools/docx/tool-docx-search-modes-and-scope/20260317-192153-234/artifacts.json`
- `20260317-192153-235` | failed | `tests/logs/ai/backend/tools/docx/tool-docx-save-conflict-and-overwrite/20260317-192153-235/meta.json` | `tests/logs/ai/backend/tools/docx/tool-docx-save-conflict-and-overwrite/20260317-192153-235/timeline.jsonl` | `tests/logs/ai/backend/tools/docx/tool-docx-save-conflict-and-overwrite/20260317-192153-235/artifacts.json`
- `20260317-192153-249` | failed | `tests/logs/ai/backend/tools/docx/tool-docx-mixed-structural-edit/20260317-192153-249/meta.json` | `tests/logs/ai/backend/tools/docx/tool-docx-mixed-structural-edit/20260317-192153-249/timeline.jsonl` | `tests/logs/ai/backend/tools/docx/tool-docx-mixed-structural-edit/20260317-192153-249/artifacts.json`
- `20260317-192303-609` | failed | `tests/logs/ai/backend/tools/docx/tool-docx-mixed-structural-edit/20260317-192303-609/meta.json` | `tests/logs/ai/backend/tools/docx/tool-docx-mixed-structural-edit/20260317-192303-609/timeline.jsonl` | `tests/logs/ai/backend/tools/docx/tool-docx-mixed-structural-edit/20260317-192303-609/artifacts.json`
- `20260317-192326-710` | failed | `tests/logs/ai/backend/tools/docx/tool-docx-mixed-structural-edit/20260317-192326-710/meta.json` | `tests/logs/ai/backend/tools/docx/tool-docx-mixed-structural-edit/20260317-192326-710/timeline.jsonl` | `tests/logs/ai/backend/tools/docx/tool-docx-mixed-structural-edit/20260317-192326-710/artifacts.json`

##### 通过率

- 历史总数据:
  - totalRuns: 32
  - passedRuns: 27
  - failedRuns: 5
  - historicalSuccessRate: 84.4%
- 最新总数据:
  - latestCaseCount: 8
  - latestPassedCases: 8
  - latestFailedCases: 0
  - latestSuccessRate: 100.0%

##### 失败分析

- 以下 failed assertion 全部来自历史 failed run，用于保留调试证据；它们不表示这些 case 的最新一轮 run 仍然失败。
- `tool-docx-search-modes-and-scope/20260317-192153-234` 的 `timeline.jsonl` 记录了 `semantic index row mismatch: blocks=6, rows=1`。
- `tool-docx-save-conflict-and-overwrite/20260317-192153-235` 的 `timeline.jsonl` 记录了 `ENOENT: no such file or directory, stat '.../exports/final.docx'`。
- `tool-docx-mixed-structural-edit` 在三次 failed run 中分别记录了三类失败断言：
  - `20260317-192153-249`：`改写后的结构中应同时出现替换、插入和表格更新结果`
  - `20260317-192303-609`：`插入的新段落应可以被搜索到`
  - `20260317-192326-710`：`更新后的表格负责人应可以被搜索到`

##### 当前评估

- `docx` 组已经覆盖 Stage 1 计划中的 8 条工具用例，且每个 case 最新一轮 run 都已通过。
- 当前 raw logs 仍保留了 5 条历史 failed run，因此该节点的累计通过率还没有回到 100%；但“按每个 case 只看最新一轮”的口径下，当前是 `8 / 8 passed`。
- 从失败分布看，历史失败集中在搜索模式、保存冲突和复杂结构编辑三个 case，其余 5 个 case 在当前 analysis window 内没有 failed run。

##### 下一步建议

- 继续保留当前 8 条 `docx` case 做回归，不要覆盖现有 failed run 证据。
- 进入 Stage 2 前，优先让 `human` 复用这 8 条 `docx` 工具基线，而不是再扩写新的 `docx` tool case。

#### terminal

##### 证据

- `20260317-192415-874` | passed | `tests/logs/ai/backend/tools/terminal/tool-terminal-approval-and-boundary/20260317-192415-874/meta.json` | `tests/logs/ai/backend/tools/terminal/tool-terminal-approval-and-boundary/20260317-192415-874/timeline.jsonl` | `tests/logs/ai/backend/tools/terminal/tool-terminal-approval-and-boundary/20260317-192415-874/artifacts.json`
- `20260317-192415-782` | passed | `tests/logs/ai/backend/tools/terminal/tool-terminal-approval-denied-follow-up/20260317-192415-782/meta.json` | `tests/logs/ai/backend/tools/terminal/tool-terminal-approval-denied-follow-up/20260317-192415-782/timeline.jsonl` | `tests/logs/ai/backend/tools/terminal/tool-terminal-approval-denied-follow-up/20260317-192415-782/artifacts.json`
- `20260317-192415-907` | passed | `tests/logs/ai/backend/tools/terminal/tool-terminal-artifact-producing-command/20260317-192415-907/meta.json` | `tests/logs/ai/backend/tools/terminal/tool-terminal-artifact-producing-command/20260317-192415-907/timeline.jsonl` | `tests/logs/ai/backend/tools/terminal/tool-terminal-artifact-producing-command/20260317-192415-907/artifacts.json`
- `20260317-192415-817` | passed | `tests/logs/ai/backend/tools/terminal/tool-terminal-batch-material-summary/20260317-192415-817/meta.json` | `tests/logs/ai/backend/tools/terminal/tool-terminal-batch-material-summary/20260317-192415-817/timeline.jsonl` | `tests/logs/ai/backend/tools/terminal/tool-terminal-batch-material-summary/20260317-192415-817/artifacts.json`
- `20260317-192415-190` | passed | `tests/logs/ai/backend/tools/terminal/tool-terminal-failure-and-long-output/20260317-192415-190/meta.json` | `tests/logs/ai/backend/tools/terminal/tool-terminal-failure-and-long-output/20260317-192415-190/timeline.jsonl` | `tests/logs/ai/backend/tools/terminal/tool-terminal-failure-and-long-output/20260317-192415-190/artifacts.json`
- `20260317-192415-809` | passed | `tests/logs/ai/backend/tools/terminal/tool-terminal-path-resolution/20260317-192415-809/meta.json` | `tests/logs/ai/backend/tools/terminal/tool-terminal-path-resolution/20260317-192415-809/timeline.jsonl` | `tests/logs/ai/backend/tools/terminal/tool-terminal-path-resolution/20260317-192415-809/artifacts.json`
- `20260317-192415-865` | passed | `tests/logs/ai/backend/tools/terminal/tool-terminal-workspace-material-discovery/20260317-192415-865/meta.json` | `tests/logs/ai/backend/tools/terminal/tool-terminal-workspace-material-discovery/20260317-192415-865/timeline.jsonl` | `tests/logs/ai/backend/tools/terminal/tool-terminal-workspace-material-discovery/20260317-192415-865/artifacts.json`

##### 通过率

- 历史总数据:
  - totalRuns: 28
  - passedRuns: 28
  - failedRuns: 0
  - historicalSuccessRate: 100.0%
- 最新总数据:
  - latestCaseCount: 7
  - latestPassedCases: 7
  - latestFailedCases: 0
  - latestSuccessRate: 100.0%

##### 失败分析

- 当前没有 failed run，因此无法给出失败模式结论。

##### 当前评估

- `terminal` 组已经覆盖材料发现、路径解析、批量读取、产物识别、审批批准、审批拒绝与长输出失败等 Stage 1 目标范围。
- 当前 analysis window 下所有 `terminal` raw logs 都是 passed，说明这一组已经具备稳定回归基线。

##### 下一步建议

- Stage 2 `human` 中优先复用 `approval-and-boundary`、`approval-denied-follow-up`、`artifact-producing-command` 三条 terminal case。
- 在新增 `human` / `entire` case 前，先保持 `terminal` 组目录结构和命名稳定，避免后续 report 范围漂移。

#### kb

##### 证据

- `20260317-192415-995` | passed | `tests/logs/ai/backend/tools/kb/tool-kb-empty-scope-and-no-result/20260317-192415-995/meta.json` | `tests/logs/ai/backend/tools/kb/tool-kb-empty-scope-and-no-result/20260317-192415-995/timeline.jsonl` | `tests/logs/ai/backend/tools/kb/tool-kb-empty-scope-and-no-result/20260317-192415-995/artifacts.json`
- `20260317-192415-888` | passed | `tests/logs/ai/backend/tools/kb/tool-kb-fts-search/20260317-192415-888/meta.json` | `tests/logs/ai/backend/tools/kb/tool-kb-fts-search/20260317-192415-888/timeline.jsonl` | `tests/logs/ai/backend/tools/kb/tool-kb-fts-search/20260317-192415-888/artifacts.json`
- `20260317-192416-151` | passed | `tests/logs/ai/backend/tools/kb/tool-kb-hybrid-search/20260317-192416-151/meta.json` | `tests/logs/ai/backend/tools/kb/tool-kb-hybrid-search/20260317-192416-151/timeline.jsonl` | `tests/logs/ai/backend/tools/kb/tool-kb-hybrid-search/20260317-192416-151/artifacts.json`
- `20260317-192416-072` | passed | `tests/logs/ai/backend/tools/kb/tool-kb-list-documents-and-scope-filter/20260317-192416-072/meta.json` | `tests/logs/ai/backend/tools/kb/tool-kb-list-documents-and-scope-filter/20260317-192416-072/timeline.jsonl` | `tests/logs/ai/backend/tools/kb/tool-kb-list-documents-and-scope-filter/20260317-192416-072/artifacts.json`
- `20260317-192416-124` | passed | `tests/logs/ai/backend/tools/kb/tool-kb-vector-search/20260317-192416-124/meta.json` | `tests/logs/ai/backend/tools/kb/tool-kb-vector-search/20260317-192416-124/timeline.jsonl` | `tests/logs/ai/backend/tools/kb/tool-kb-vector-search/20260317-192416-124/artifacts.json`

##### 通过率

- 历史总数据:
  - totalRuns: 20
  - passedRuns: 20
  - failedRuns: 0
  - historicalSuccessRate: 100.0%
- 最新总数据:
  - latestCaseCount: 5
  - latestPassedCases: 5
  - latestFailedCases: 0
  - latestSuccessRate: 100.0%

##### 失败分析

- 当前没有 failed run，因此无法给出失败模式结论。

##### 当前评估

- `kb` 组已经覆盖 `hybrid / vector / fts / list_documents` 以及 `empty scope / no-result` 边界。
- 当前 analysis window 下所有 `kb` raw logs 都是 passed，说明检索工具层的基础契约已经稳定。

##### 下一步建议

- Stage 2 `human` 中优先复用 `tool-kb-hybrid-search` 与 `tool-kb-empty-scope-and-no-result` 两条证据链最强的 case。
- 后续如果新增 `kb` tool case，建议继续沿用当前 `kb/<caseId>` 目录树，不要另起平行 suite。

### human

#### 证据

- `20260318-110111-998` | passed | `tests/logs/ai/backend/human/human-approval-blocked-recovery/20260318-110111-998/meta.json` | `tests/logs/ai/backend/human/human-approval-blocked-recovery/20260318-110111-998/timeline.jsonl` | `tests/logs/ai/backend/human/human-approval-blocked-recovery/20260318-110111-998/artifacts.json`
- `20260318-110111-457` | passed | `tests/logs/ai/backend/human/human-direct-docx-edit/20260318-110111-457/meta.json` | `tests/logs/ai/backend/human/human-direct-docx-edit/20260318-110111-457/timeline.jsonl` | `tests/logs/ai/backend/human/human-direct-docx-edit/20260318-110111-457/artifacts.json`
- `20260318-110111-471` | passed | `tests/logs/ai/backend/human/human-direct-kb-answer/20260318-110111-471/meta.json` | `tests/logs/ai/backend/human/human-direct-kb-answer/20260318-110111-471/timeline.jsonl` | `tests/logs/ai/backend/human/human-direct-kb-answer/20260318-110111-471/artifacts.json`
- `20260318-110111-456` | passed | `tests/logs/ai/backend/human/human-evidence-insufficient-safe-stop/20260318-110111-456/meta.json` | `tests/logs/ai/backend/human/human-evidence-insufficient-safe-stop/20260318-110111-456/timeline.jsonl` | `tests/logs/ai/backend/human/human-evidence-insufficient-safe-stop/20260318-110111-456/artifacts.json`
- `20260318-110111-457` | passed | `tests/logs/ai/backend/human/human-kb-docx-bridge/20260318-110111-457/meta.json` | `tests/logs/ai/backend/human/human-kb-docx-bridge/20260318-110111-457/timeline.jsonl` | `tests/logs/ai/backend/human/human-kb-docx-bridge/20260318-110111-457/artifacts.json`
- `20260318-110111-457` | passed | `tests/logs/ai/backend/human/human-multi-source-merge-delivery/20260318-110111-457/meta.json` | `tests/logs/ai/backend/human/human-multi-source-merge-delivery/20260318-110111-457/timeline.jsonl` | `tests/logs/ai/backend/human/human-multi-source-merge-delivery/20260318-110111-457/artifacts.json`
- `20260318-110111-455` | passed | `tests/logs/ai/backend/human/human-no-redundant-recheck/20260318-110111-455/meta.json` | `tests/logs/ai/backend/human/human-no-redundant-recheck/20260318-110111-455/timeline.jsonl` | `tests/logs/ai/backend/human/human-no-redundant-recheck/20260318-110111-455/artifacts.json`
- `20260318-110111-458` | passed | `tests/logs/ai/backend/human/human-review-handoff-structured-delivery/20260318-110111-458/meta.json` | `tests/logs/ai/backend/human/human-review-handoff-structured-delivery/20260318-110111-458/timeline.jsonl` | `tests/logs/ai/backend/human/human-review-handoff-structured-delivery/20260318-110111-458/artifacts.json`
- `20260318-110111-470` | passed | `tests/logs/ai/backend/human/human-terminal-docx-handoff/20260318-110111-470/meta.json` | `tests/logs/ai/backend/human/human-terminal-docx-handoff/20260318-110111-470/timeline.jsonl` | `tests/logs/ai/backend/human/human-terminal-docx-handoff/20260318-110111-470/artifacts.json`
- `20260318-110111-471` | passed | `tests/logs/ai/backend/human/human-tool-failure-recovery/20260318-110111-471/meta.json` | `tests/logs/ai/backend/human/human-tool-failure-recovery/20260318-110111-471/timeline.jsonl` | `tests/logs/ai/backend/human/human-tool-failure-recovery/20260318-110111-471/artifacts.json`
- `20260318-110111-994` | passed | `tests/logs/ai/backend/human/human-workspace-blocked-recovery/20260318-110111-994/meta.json` | `tests/logs/ai/backend/human/human-workspace-blocked-recovery/20260318-110111-994/timeline.jsonl` | `tests/logs/ai/backend/human/human-workspace-blocked-recovery/20260318-110111-994/artifacts.json`
- `20260318-101533-755` | failed | `tests/logs/ai/backend/human/human-direct-kb-answer/20260318-101533-755/meta.json` | `tests/logs/ai/backend/human/human-direct-kb-answer/20260318-101533-755/timeline.jsonl` | `tests/logs/ai/backend/human/human-direct-kb-answer/20260318-101533-755/artifacts.json`
- `20260318-101533-750` | failed | `tests/logs/ai/backend/human/human-direct-docx-edit/20260318-101533-750/meta.json` | `tests/logs/ai/backend/human/human-direct-docx-edit/20260318-101533-750/timeline.jsonl` | `tests/logs/ai/backend/human/human-direct-docx-edit/20260318-101533-750/artifacts.json`
- `20260318-101649-623` | failed | `tests/logs/ai/backend/human/human-direct-docx-edit/20260318-101649-623/meta.json` | `tests/logs/ai/backend/human/human-direct-docx-edit/20260318-101649-623/timeline.jsonl` | `tests/logs/ai/backend/human/human-direct-docx-edit/20260318-101649-623/artifacts.json`
- `20260318-101735-733` | failed | `tests/logs/ai/backend/human/human-direct-docx-edit/20260318-101735-733/meta.json` | `tests/logs/ai/backend/human/human-direct-docx-edit/20260318-101735-733/timeline.jsonl` | `tests/logs/ai/backend/human/human-direct-docx-edit/20260318-101735-733/artifacts.json`
- `20260318-101803-547` | failed | `tests/logs/ai/backend/human/human-direct-docx-edit/20260318-101803-547/meta.json` | `tests/logs/ai/backend/human/human-direct-docx-edit/20260318-101803-547/timeline.jsonl` | `tests/logs/ai/backend/human/human-direct-docx-edit/20260318-101803-547/artifacts.json`
- `20260318-101903-774` | failed | `tests/logs/ai/backend/human/human-direct-docx-edit/20260318-101903-774/meta.json` | `tests/logs/ai/backend/human/human-direct-docx-edit/20260318-101903-774/timeline.jsonl` | `tests/logs/ai/backend/human/human-direct-docx-edit/20260318-101903-774/artifacts.json`
- `20260318-102103-103` | failed | `tests/logs/ai/backend/human/human-direct-docx-edit/20260318-102103-103/meta.json` | `tests/logs/ai/backend/human/human-direct-docx-edit/20260318-102103-103/timeline.jsonl` | `tests/logs/ai/backend/human/human-direct-docx-edit/20260318-102103-103/artifacts.json`
- `20260318-105003-985` | failed | `tests/logs/ai/backend/human/human-kb-docx-bridge/20260318-105003-985/meta.json` | `tests/logs/ai/backend/human/human-kb-docx-bridge/20260318-105003-985/timeline.jsonl` | `tests/logs/ai/backend/human/human-kb-docx-bridge/20260318-105003-985/artifacts.json`
- `20260318-104347-366` | failed | `tests/logs/ai/backend/human/human-workspace-blocked-recovery/20260318-104347-366/meta.json` | `tests/logs/ai/backend/human/human-workspace-blocked-recovery/20260318-104347-366/timeline.jsonl` | `tests/logs/ai/backend/human/human-workspace-blocked-recovery/20260318-104347-366/artifacts.json`

#### 通过率

- 历史总数据:
  - totalRuns: 52
  - passedRuns: 43
  - failedRuns: 9
  - historicalSuccessRate: 82.7%
- 最新总数据:
  - latestCaseCount: 11
  - latestPassedCases: 11
  - latestFailedCases: 0
  - latestSuccessRate: 100.0%

#### 失败分析

- 以下 failed assertion 全部来自首轮 authoring 调试证据；它们不表示 `human` 的最新一轮 run 仍然失败。
- `human-direct-kb-answer/20260318-101533-755` 先前把 case 绑在自动补全文档引用上，导致断言口径过窄。
- `human-direct-docx-edit` 的多次 failed run 主要暴露了三类实现真相：
  - `20260318-101533-750` 与 `20260318-101649-623`：最初按“最终落盘文件”验收，但当前交付更稳定的是 preview artifact。
  - `20260318-101803-547` 与 `20260318-101903-774`：当时断言数据已记录 preview/saved 不存在，说明路径与验收对象判断有偏差。
  - `20260318-102103-103`：tool order 断言把 inspection harness 的额外工具调用也算进去了。
- `human-kb-docx-bridge/20260318-105003-985` 暴露了 KB 检索工具的输出形态细节：`outputPreview` 是结果数组预览，不能按单对象 summary 去断言。
- `human-workspace-blocked-recovery/20260318-104347-366` 暴露了 guard tool 的事件口径细节：该路径会直接产出 `workspace_required`，但不会留下 `tool_call_started`。

#### 当前评估

- Stage 2 已落地 11 条 `human` backend case，覆盖 direct KB answer、direct docx edit、tool failure recovery、workspace blocked、approval blocked、terminal-docx handoff、kb-docx bridge、multi-source merge、review handoff、safe stop 与 no redundant recheck 十一条基础路径。
- `human-direct-docx-edit` 当前以 preview artifact 作为“可审阅交付”验收，而不是最终 committed docx；这与当前 `docx-editing` 技能的运行期约束一致。
- 当前 `human` 已经补齐 direct、blocked、handoff、bridge、merge、review-ready、safe-stop 与 no-redundant 八类高价值基线，说明 `human` 不再只停留在单点工具调用层。
- 虽然 `human` suite 当前历史总通过率只有 `82.7%`，但这是因为 raw logs 保留了 authoring 过程中的 9 次 failed run；按“每个 case 只看最新一轮”的最新总口径，当前已经是 `11 / 11 passed`，即 latestSuccessRate=`100.0%`。

#### 下一步建议

- 先继续补 `human-multi-turn-refinement`，验证 `human` 能否围绕上一轮中间产物稳定续做。
- 再推进 `human-long-task-project-brief` 与 `human-partial-delivery-on-budget-limit`，把长任务与预算受限收敛能力补齐。
