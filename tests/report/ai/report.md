# AI 域测试报告

## 总览

### 分析范围

- raw logs 范围: 当前仓库内 `tests/logs/ai/**`
- 已分析 scope: `ai/backend/tools/docx`、`ai/backend/tools/terminal`、`ai/backend/tools/kb`

### 总体结论

- 累计运行: `80` 次 raw runs，其中 `75` 次 passed、`5` 次 failed
- 最新快照: `20 / 20` 个 case 的最新一轮 run 为 passed
- 当前结论: Stage 1 `backend/tools` 已形成完整 raw logs 基线；当前需要区分“历史 failed run 证据”与“每个 case 最新一轮状态”，两者不是同一个统计口径。

### 下一阶段建议

- 优先推进 `backend/human`，先复用已经稳定的 `tools` 基线，不要在 Stage 1 继续扩写新的 tool case
- `human` 阶段先覆盖 `direct-kb-answer`、`direct-docx-edit`、`tool-failure-recovery` 这类直接依赖当前 tool 基线的 case

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

- totalRuns: 32
- passedRuns: 27
- failedRuns: 5
- successRate: 84.4%
- latestCaseCount: 8
- latestPassedCases: 8
- latestFailedCases: 0

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

- totalRuns: 28
- passedRuns: 28
- failedRuns: 0
- successRate: 100.0%
- latestCaseCount: 7
- latestPassedCases: 7
- latestFailedCases: 0

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

- totalRuns: 20
- passedRuns: 20
- failedRuns: 0
- successRate: 100.0%
- latestCaseCount: 5
- latestPassedCases: 5
- latestFailedCases: 0

##### 失败分析

- 当前没有 failed run，因此无法给出失败模式结论。

##### 当前评估

- `kb` 组已经覆盖 `hybrid / vector / fts / list_documents` 以及 `empty scope / no-result` 边界。
- 当前 analysis window 下所有 `kb` raw logs 都是 passed，说明检索工具层的基础契约已经稳定。

##### 下一步建议

- Stage 2 `human` 中优先复用 `tool-kb-hybrid-search` 与 `tool-kb-empty-scope-and-no-result` 两条证据链最强的 case。
- 后续如果新增 `kb` tool case，建议继续沿用当前 `kb/<caseId>` 目录树，不要另起平行 suite。
