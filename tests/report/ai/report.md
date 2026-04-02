# AI 域测试报告

## 总览

- raw logs 范围：当前仓库内 `tests/logs/ai/**`
- 本次分析窗口：2026-04-02 清空 AI 域历史产物后，已重新执行 `tool` 与 `human/mock-llm`
- 本次纳入分析的 suite：`tool`、`human`
- 当前未纳入分析的范围：`human/live` 与 `director`，原因是当前 raw logs 为空

### 总体结论

- 历史总数据：`totalRuns=27`、`passedRuns=27`、`failedRuns=0`、`historicalSuccessRate=100.0%`
- 最新总数据：`latestCaseCount=27`、`latestPassedCases=27`、`latestFailedCases=0`、`latestSuccessRate=100.0%`
- 当前结论：本轮从空日志窗口重新执行后，`tool` suite 的 `docx / kb / terminal / hand` 四组正式 case 与 `human/mock-llm` 的 10 条正式 case 均已全绿；抽样 `timeline.jsonl` 已确认 `human` 真实走到了 `brain / learning / hand / mouth` 主链、真实 KB 检索、真实审批拒绝边界和真实多工具协作。

### 下一阶段建议

- 以当前 `tool` 全绿结果作为新的 AI 域基线
- 以当前 `tool + human/mock-llm` 全绿结果作为新的 AI 域阶段性基线
- 下一步优先执行 `human/live`，验证真实模型下是否仍能稳定消费当前工具与 graph 能力
- `director` 的正式结论，待其 raw logs 生成后再补入本报告

## tool

### 证据

- `docx-complex-ops-batch` | `20260402-103912-914` | `passed`
- `docx-format-variants-contract` | `20260402-103912-925` | `passed`
- `docx-history-and-rollback` | `20260402-103912-876` | `passed`
- `docx-large-document-navigation` | `20260402-103918-099` | `passed`
- `docx-minimal-edit-flow` | `20260402-103918-123` | `passed`
- `docx-mixed-format-preservation` | `20260402-103912-919` | `passed`
- `docx-precondition-guard` | `20260402-103919-406` | `passed`
- `docx-review-aware-open-and-continue-edit` | `20260402-103912-909` | `passed`
- `docx-save-overwrite-approval` | `20260402-103912-936` | `passed`
- `hand-parallel-safety-contract` | `20260402-103916-407` | `passed`
- `hand-tool-limit-and-artifact-merge` | `20260402-103917-539` | `passed`
- `kb-document-discovery-contract` | `20260402-103912-876` | `passed`
- `kb-evidence-search-family-contract` | `20260402-103912-877` | `passed`
- `terminal-directory-inspection-readonly` | `20260402-103912-918` | `passed`
- `terminal-inline-edit-artifact-contract` | `20260402-103918-103` | `passed`
- `terminal-risk-and-boundary-guard` | `20260402-103918-690` | `passed`
- `terminal-text-search-readonly` | `20260402-103917-923` | `passed`

### 通过率

- 历史总数据：`totalRuns=17`、`passedRuns=17`、`failedRuns=0`、`historicalSuccessRate=100.0%`
- 最新总数据：`latestCaseCount=17`、`latestPassedCases=17`、`latestFailedCases=0`、`latestSuccessRate=100.0%`

### 失败分析

- 当前没有 failed run，因此本轮没有新的失败模式可分析。

### 当前评估

- `docx` 9 条 case 全部通过；抽样 `docx-minimal-edit-flow` 的 `timeline.jsonl` 已确认真实产生新 `docId`、目标 `changedBlocks` 与 preview artifact。
- `kb` 2 条 case 全部通过；抽样 `kb-evidence-search-family-contract` 的 `timeline.jsonl` 已确认 `hybrid / vector / fts` 三类检索都返回稳定结构，并遵守 `documentIds` 范围约束。
- `terminal` 4 条 case 全部通过；抽样 `terminal-inline-edit-artifact-contract` 的 `timeline.jsonl` 已确认 mutating 命令经过审批，并记录更新/创建文件 artifact。
- `hand` 2 条 case 全部通过；抽样 `hand-tool-limit-and-artifact-merge` 的 `timeline.jsonl` 已确认 runtimeArtifacts 正常合并，并在超过上限后产出收敛型 `watchHint`。
- 从当前 raw logs 看，`tool` suite 已可作为继续推进 `human` 与 `director` 的稳定正式基线。

### 下一步建议

- 保持当前 `tool` suite 的全绿面
- 继续转到 `human/mock-llm`，优先验证 `createAiRunContext -> human graph -> learning / hand / mouth` 在当前工具基线上的闭环稳定性

## human

### 证据

- `approval-denied-restricted-delivery` | `20260402-104117-259` | `passed`
- `brain-memory-write-boundary` | `20260402-104113-948` | `passed`
- `complex-docx-edit` | `20260402-104113-943` | `passed`
- `delivery-mode-contract` | `20260402-104113-943` | `passed`
- `kb-answer-with-real-kb` | `20260402-104113-944` | `passed`
- `learning-hand-mouth-smoke` | `20260402-104113-944` | `passed`
- `multi-tool-collaboration` | `20260402-104113-933` | `passed`
- `tool-failure-recovery` | `20260402-104113-944` | `passed`
- `tool-limit-converge` | `20260402-104113-947` | `passed`
- `watchhint-retry` | `20260402-104113-944` | `passed`

### 通过率

- 历史总数据：`totalRuns=10`、`passedRuns=10`、`failedRuns=0`、`historicalSuccessRate=100.0%`
- 最新总数据：`latestCaseCount=10`、`latestPassedCases=10`、`latestFailedCases=0`、`latestSuccessRate=100.0%`

### 失败分析

- 当前没有 failed run，因此本轮没有新的失败模式可分析。

### 当前评估

- `learning-hand-mouth-smoke` 的 `timeline.jsonl` 已确认真实经过 `brain -> learning -> hand -> mouth` 四段主链，并完成真实工具调用与真实 mouth 收口。
- `kb-answer-with-real-kb` 的 `timeline.jsonl` 已确认 mock-llm 只替换结构化输出，KB 证据仍来自真实 KB 存储、真实检索结果和真实 mouth prompt 拼装。
- `approval-denied-restricted-delivery` 的 `timeline.jsonl` 已确认审批拒绝会阻止真实 terminal 命令落地，并把 `approval_denied` 传回 human 收敛。
- `multi-tool-collaboration` 的 `timeline.jsonl` 已确认真实 `hand` 节点执行了并行多工具协作，而不是脚本化 runtime 结果。
- 从当前 raw logs 看，`human/mock-llm` 已形成稳定正式基线，可以继续向 `human/live` 推进。

### 下一步建议

- 保持当前 `human/mock-llm` 全绿面
- 继续转到 `human/live`，优先观察真实模型下的工具选择、参数构造与最终交付是否稳定

## director

- 当前暂无 raw logs
- 待后续重新执行后再回填结论
