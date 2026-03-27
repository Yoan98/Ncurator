# AI 域测试报告

## 总览

### 分析范围

- raw logs 范围：当前仓库内 `tests/logs/ai/**`
- 本次分析窗口：当前仓库内 AI 域全部 raw runs
- 本次纳入分析的 suite：`tool`、`human`
- 本次纳入分析的 groups：`tool/docx`、`tool/kb`、`tool/terminal`、`tool/hand`、`human/basics`、`human/scenarios`

### 总体结论

- 历史总数据：`totalRuns=93`、`passedRuns=84`、`failedRuns=9`、`historicalSuccessRate=90.3%`
- 最新总数据：`latestCaseCount=26`、`latestPassedCases=26`、`latestFailedCases=0`、`latestSuccessRate=100.0%`
- 当前结论：AI 域当前已经形成 `tool` suite 与 `human/basics + scenarios` 的 latest 全绿覆盖面；历史 failed run 主要集中在早期 `tool` 守卫边界、`human` 基础失败恢复，以及本轮 `human/scenarios` 的调试对齐过程。

### 下一阶段建议

- 先补齐 `human/live`
- 再推进 `director/basics` 与 `director/contracts`

## tool

### 证据

- `docx-complex-ops-batch` | `20260327-170141-455` | `passed`
- `docx-format-variants-contract` | `20260327-170141-447` | `passed`
- `docx-history-and-rollback` | `20260327-170141-410` | `passed`
- `docx-large-document-navigation` | `20260327-170141-408` | `passed`
- `docx-minimal-edit-flow` | `20260327-170143-506` | `passed`
- `docx-mixed-format-preservation` | `20260327-170141-454` | `passed`
- `docx-precondition-guard` | `20260327-170143-804` | `passed`
- `docx-review-aware-open-and-continue-edit` | `20260327-170141-407` | `passed`
- `docx-save-overwrite-approval` | `20260327-170141-488` | `passed`
- `hand-parallel-safety-contract` | `20260327-170143-788` | `passed`
- `hand-tool-limit-and-artifact-merge` | `20260327-170141-623` | `passed`
- `kb-document-discovery-contract` | `20260327-170143-801` | `passed`
- `kb-evidence-search-family-contract` | `20260327-170143-590` | `passed`
- `terminal-directory-inspection-readonly` | `20260327-170141-456` | `passed`
- `terminal-inline-edit-artifact-contract` | `20260327-170143-582` | `passed`
- `terminal-risk-and-boundary-guard` | `20260327-170143-790` | `passed`
- `terminal-text-search-readonly` | `20260327-170143-557` | `passed`

### 通过率

- 历史总数据：`totalRuns=67`、`passedRuns=63`、`failedRuns=4`、`historicalSuccessRate=94.0%`
- 最新总数据：`latestCaseCount=17`、`latestPassedCases=17`、`latestFailedCases=0`、`latestSuccessRate=100.0%`

### 失败分析

- 历史 failed run 共 `4` 次：
- `docx-mixed-format-preservation` | `20260327-161231-086` | `failed`
- `docx-precondition-guard` | `20260327-161233-196` | `failed`
- `hand-parallel-safety-contract` | `20260327-160614-669` | `failed`
- `hand-tool-limit-and-artifact-merge` | `20260327-160614-673` | `failed`
- 上述 4 条 case 的最新 run 均已转为 `passed`，因此当前 suite 没有 latest failed case。

### 当前评估

- `tool` suite 当前已经覆盖 `docx / kb / terminal / hand` 四类长期稳定边界。
- 从 latest 口径看，当前没有证据表明工具层存在新的回归。
- 从历史口径看，早期 failed run 说明 `docx` 复杂格式契约与 `hand` 守卫边界曾出现过对齐偏差，但这些偏差已经不再出现在最新 run 中。

### 下一步建议

- 保持 `tool` suite 的 latest 通过面
- 把现有工具稳定性继续提升到 `human/live` 与 `director`

### docx

#### 证据

- `docx-complex-ops-batch` | `20260327-170141-455` | `passed`
- `docx-format-variants-contract` | `20260327-170141-447` | `passed`
- `docx-history-and-rollback` | `20260327-170141-410` | `passed`
- `docx-large-document-navigation` | `20260327-170141-408` | `passed`
- `docx-minimal-edit-flow` | `20260327-170143-506` | `passed`
- `docx-mixed-format-preservation` | `20260327-170141-454` | `passed`
- `docx-precondition-guard` | `20260327-170143-804` | `passed`
- `docx-review-aware-open-and-continue-edit` | `20260327-170141-407` | `passed`
- `docx-save-overwrite-approval` | `20260327-170141-488` | `passed`

#### 通过率

- 历史总数据：`totalRuns=27`、`passedRuns=25`、`failedRuns=2`、`historicalSuccessRate=92.6%`
- 最新总数据：`latestCaseCount=9`、`latestPassedCases=9`、`latestFailedCases=0`、`latestSuccessRate=100.0%`

#### 失败分析

- 历史 failed run 共 `2` 次：
- `docx-mixed-format-preservation` | `20260327-161231-086` | `failed`
- `docx-precondition-guard` | `20260327-161233-196` | `failed`
- 这两条 case 的最新 run 均已为 `passed`，因此当前 group 没有 latest failed case。

#### 当前评估

- `docx` 组当前已经覆盖最小编辑、长文导航、复杂 op、格式变体、mixed-format、review-aware、history/rollback、precondition 与 save approval。
- 从 latest 口径看，`docx` 工具层高风险读写契约已经形成稳定正式覆盖。

#### 下一步建议

- 继续维持当前 `docx` latest 通过面
- 将 `docx` 复杂编辑链路继续向 `human/live` 提升

### kb

#### 证据

- `kb-document-discovery-contract` | `20260327-170143-801` | `passed`
- `kb-evidence-search-family-contract` | `20260327-170143-590` | `passed`

#### 通过率

- 历史总数据：`totalRuns=10`、`passedRuns=10`、`failedRuns=0`、`historicalSuccessRate=100.0%`
- 最新总数据：`latestCaseCount=2`、`latestPassedCases=2`、`latestFailedCases=0`、`latestSuccessRate=100.0%`

#### 失败分析

- 当前没有 failed run，因此无法给出失败模式结论。

#### 当前评估

- `kb` 组已经覆盖文档发现和三类检索工具的统一契约。
- 当前没有证据表明 `kb` 工具存在范围越界或结果结构不稳定的问题。

#### 下一步建议

- 保持当前 `kb` 正式覆盖面
- 后续把 `kb` 工具稳定性继续转成 `human` 层闭环覆盖

### terminal

#### 证据

- `terminal-directory-inspection-readonly` | `20260327-170141-456` | `passed`
- `terminal-inline-edit-artifact-contract` | `20260327-170143-582` | `passed`
- `terminal-risk-and-boundary-guard` | `20260327-170143-790` | `passed`
- `terminal-text-search-readonly` | `20260327-170143-557` | `passed`

#### 通过率

- 历史总数据：`totalRuns=20`、`passedRuns=20`、`failedRuns=0`、`historicalSuccessRate=100.0%`
- 最新总数据：`latestCaseCount=4`、`latestPassedCases=4`、`latestFailedCases=0`、`latestSuccessRate=100.0%`

#### 失败分析

- 当前没有 failed run，因此无法给出失败模式结论。

#### 当前评估

- `terminal` 组已经覆盖只读检查、文本搜索、文本变更、审批边界与 workspace 边界保护。
- 当前没有证据表明越界命令会进入真实执行步骤。

#### 下一步建议

- 维持当前 `terminal` latest 通过面
- 在 `human/live` 与 `director` 层继续消费 terminal 的稳定契约

### hand

#### 证据

- `hand-parallel-safety-contract` | `20260327-170143-788` | `passed`
- `hand-tool-limit-and-artifact-merge` | `20260327-170141-623` | `passed`

#### 通过率

- 历史总数据：`totalRuns=10`、`passedRuns=8`、`failedRuns=2`、`historicalSuccessRate=80.0%`
- 最新总数据：`latestCaseCount=2`、`latestPassedCases=2`、`latestFailedCases=0`、`latestSuccessRate=100.0%`

#### 失败分析

- 历史 failed run 共 `2` 次：
- `hand-parallel-safety-contract` | `20260327-160614-669` | `failed`
- `hand-tool-limit-and-artifact-merge` | `20260327-160614-673` | `failed`
- 这两条 case 的最新 run 均已为 `passed`，因此当前 group 没有 latest failed case。

#### 当前评估

- `hand` 组当前已经覆盖并行安全守卫、工具上限与 runtime artifact 合并三个核心边界。
- 从 latest 口径看，`hand` 已经足够支撑继续向 `human` 层推进。

#### 下一步建议

- 在保持 `hand` latest 通过面的前提下继续支撑 `human/live` 与 `director` 场景
- 优先观察上层是否能稳定消费 `watchHint` 与 `runtimeArtifacts`

## human

### 证据

- `basic-brain-memory-write-boundary` | `20260327-164126-767` | `passed`
- `basic-delivery-mode-contract` | `20260327-164126-773` | `passed`
- `basic-learning-hand-mouth-smoke` | `20260327-164126-774` | `passed`
- `basic-tool-failure-recovery` | `20260327-164126-773` | `passed`
- `basic-tool-limit-converge` | `20260327-164126-774` | `passed`
- `basic-watchhint-retry` | `20260327-164126-775` | `passed`
- `approval-denied-restricted-delivery` | `20260327-173741-685` | `passed`
- `complex-docx-edit-simulated` | `20260327-173741-686` | `passed`
- `multi-tool-collaboration-simulated` | `20260327-173741-685` | `passed`

### 通过率

- 历史总数据：`totalRuns=26`、`passedRuns=21`、`failedRuns=5`、`historicalSuccessRate=80.8%`
- 最新总数据：`latestCaseCount=9`、`latestPassedCases=9`、`latestFailedCases=0`、`latestSuccessRate=100.0%`

### 失败分析

- 历史 failed run 共 `5` 次：
- `basic-tool-failure-recovery` | `20260327-164036-153` | `failed`
- `complex-docx-edit-simulated` | `20260327-173012-480` | `failed`
- `complex-docx-edit-simulated` | `20260327-173518-239` | `failed`
- `complex-docx-edit-simulated` | `20260327-173630-263` | `failed`
- `multi-tool-collaboration-simulated` | `20260327-173012-478` | `failed`
- 上述 failed run 的最新 run 均已转为 `passed`，因此当前 suite 没有 latest failed case。

### 当前评估

- `human` suite 当前已经形成 `basics` 与 `scenarios` 两组的正式 latest 覆盖。
- 从 latest 口径看，`human` 的基础主链路、`watchHint` 收敛、`deliveryMode` 契约、失败恢复、记忆写入边界、复杂 docx 编辑、多工具联动与审批拒绝收敛都已有稳定证据。
- 当前缺口已经从 `human/scenarios` 收缩到 `human/live`。

### 下一步建议

- 补齐 `human/live`
- 再进入 `director/basics` 与 `director/contracts`

### basics

#### 证据

- `basic-brain-memory-write-boundary` | `20260327-164126-767` | `passed`
- `basic-delivery-mode-contract` | `20260327-164126-773` | `passed`
- `basic-learning-hand-mouth-smoke` | `20260327-164126-774` | `passed`
- `basic-tool-failure-recovery` | `20260327-164126-773` | `passed`
- `basic-tool-limit-converge` | `20260327-164126-774` | `passed`
- `basic-watchhint-retry` | `20260327-164126-775` | `passed`

#### 通过率

- 历史总数据：`totalRuns=12`、`passedRuns=11`、`failedRuns=1`、`historicalSuccessRate=91.7%`
- 最新总数据：`latestCaseCount=6`、`latestPassedCases=6`、`latestFailedCases=0`、`latestSuccessRate=100.0%`

#### 失败分析

- 历史 failed run 共 `1` 次：
- `basic-tool-failure-recovery` | `20260327-164036-153` | `failed`
- 该 case 的最新 run 已为 `passed`，因此当前 group 没有 latest failed case。

#### 当前评估

- `basic-learning-hand-mouth-smoke` 证明 `brain -> learning -> hand -> mouth` 主链路已经能够稳定闭环。
- `basic-watchhint-retry` 证明 `memory_reducer` 与 `hand` 两类 `watchHint` 都能回到 `brain` 再次决策。
- `basic-delivery-mode-contract` 证明 `user_answer`、`task_handoff` 与 `context_note` 三种交付模式已经形成稳定边界。
- `basic-tool-failure-recovery` 证明失败工具结果不会直接打断执行链，后续仍能稳定收口。
- `basic-brain-memory-write-boundary` 证明 `brainMemory.inside` 只在 `brain` 后变化，`hand` 只扩展工具结果、artifact 与 trace。
- `basic-tool-limit-converge` 证明工具调用超过上限后会转向收敛，而不是继续循环调用。

#### 下一步建议

- 以当前 `basics` 覆盖面继续支撑 `human/scenarios` 与 `human/live`
- 在真实模型接入前先保持 `basics` latest 通过面稳定

### scenarios

#### 证据

- `approval-denied-restricted-delivery` | `20260327-173741-685` | `passed`
- `complex-docx-edit-simulated` | `20260327-173741-686` | `passed`
- `multi-tool-collaboration-simulated` | `20260327-173741-685` | `passed`

#### 通过率

- 历史总数据：`totalRuns=14`、`passedRuns=10`、`failedRuns=4`、`historicalSuccessRate=71.4%`
- 最新总数据：`latestCaseCount=3`、`latestPassedCases=3`、`latestFailedCases=0`、`latestSuccessRate=100.0%`

#### 失败分析

- 历史 failed run 共 `4` 次：
- `complex-docx-edit-simulated` | `20260327-173012-480` | `failed`
- `complex-docx-edit-simulated` | `20260327-173518-239` | `failed`
- `complex-docx-edit-simulated` | `20260327-173630-263` | `failed`
- `multi-tool-collaboration-simulated` | `20260327-173012-478` | `failed`
- 上述 failed run 主要来自本轮场景脚本与 fixture 对齐过程；当前 3 条 scenario case 的 latest run 均已为 `passed`。

#### 当前评估

- `complex-docx-edit-simulated` 证明 non-live 下的复杂 docx 长链路已经能稳定串起 read / write / validate / preview。
- `multi-tool-collaboration-simulated` 证明 KB 检索结果可以继续被 docx 写入与回查链路消费，不会在单任务中途断链。
- `approval-denied-restricted-delivery` 证明审批拒绝后 human 会停止重复撞同一动作，并以受限交付说明阻塞点、未完成项和已得到的 preview 结果。
- 从 latest 口径看，当前没有证据表明 `human/scenarios` 仍存在新的回归。

#### 下一步建议

- 保持 `human/scenarios` latest 通过面
- 将当前稳定的 scenario 契约继续提升到 `human/live` 与后续 `director` 场景
