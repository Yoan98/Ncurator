# AI 域测试报告

## 总览

### 分析范围

- raw logs 范围：当前仓库内 `tests/logs/ai/**`
- 本次分析窗口：当前仓库内 AI 域全部 raw runs
- 本次纳入分析的 suite：`tool`、`human`、`director`
- 本次纳入分析的 groups：`tool/docx`、`tool/kb`、`tool/terminal`、`tool/hand`、`human/basics`、`human/scenarios`、`human/live`、`director/basics`、`director/contracts`

### 总体结论

- 历史总数据：`totalRuns=127`、`passedRuns=108`、`failedRuns=19`、`historicalSuccessRate=85.0%`
- 最新总数据：`latestCaseCount=37`、`latestPassedCases=35`、`latestFailedCases=2`、`latestSuccessRate=94.6%`
- 当前结论：`tool` suite 与本轮新增的 `director/basics + contracts` 已形成 latest 全绿覆盖面；当前 latest failed case 仅剩 `human/live` 的 `docx-edit-autonomous-live` 与 `long-task-multi-tool-live`，两者在 raw logs 中都停在 `human.brain` 的 `structured_output_failed / 429` 限流错误，而不是 director/tool 合同回归。

### 下一阶段建议

- 先重新拉平 `human/live` 的限流与执行窗口，恢复 latest 全绿
- 再补齐 `director/live`
- 补强 `plan-task-shape-contract` 对“不可执行任务” fail-fast 的 raw-log 证据

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
- `docx-edit-autonomous-live` | `20260327-175650-244` | `failed`
- `kb-answer-autonomous-live` | `20260327-180810-136` | `passed`
- `long-task-multi-tool-live` | `20260327-175650-246` | `failed`
- `multi-tool-collaboration-simulated` | `20260327-173741-685` | `passed`

### 通过率

- 历史总数据：`totalRuns=36`、`passedRuns=22`、`failedRuns=14`、`historicalSuccessRate=61.1%`
- 最新总数据：`latestCaseCount=12`、`latestPassedCases=10`、`latestFailedCases=2`、`latestSuccessRate=83.3%`

### 失败分析

- 历史 failed run 共 `14` 次：
- `basic-tool-failure-recovery` | `20260327-164036-153` | `failed`
- `complex-docx-edit-simulated` | `20260327-173012-480` | `failed`
- `complex-docx-edit-simulated` | `20260327-173518-239` | `failed`
- `complex-docx-edit-simulated` | `20260327-173630-263` | `failed`
- `multi-tool-collaboration-simulated` | `20260327-173012-478` | `failed`
- `long-task-multi-tool-live` | `20260327-175324-266` | `failed`
- `docx-edit-autonomous-live` | `20260327-175324-266` | `failed`
- `kb-answer-autonomous-live` | `20260327-175324-267` | `failed`
- `kb-answer-autonomous-live` | `20260327-175459-454` | `failed`
- `docx-edit-autonomous-live` | `20260327-175459-454` | `failed`
- `long-task-multi-tool-live` | `20260327-175459-454` | `failed`
- `kb-answer-autonomous-live` | `20260327-175650-245` | `failed`
- `long-task-multi-tool-live` | `20260327-175650-246` | `failed`
- `docx-edit-autonomous-live` | `20260327-175650-244` | `failed`
- 当前 latest failed case 为 `docx-edit-autonomous-live` 与 `long-task-multi-tool-live`，两条 raw log 都显示 `human.brain` 在结构化输出阶段命中 `429` 限流错误；`kb-answer-autonomous-live` 的 latest run 已转为 `passed`。

### 当前评估

- `human/basics` 与 `human/scenarios` 仍保持 latest 全绿，说明基础主链路、`watchHint` 收敛、`deliveryMode` 契约、失败恢复、记忆写入边界、复杂 docx 编辑、多工具联动与审批拒绝收敛仍然稳定。
- `human/live` 已有 `kb-answer-autonomous-live` 的 latest passed 证据，但 `docx-edit-autonomous-live` 与 `long-task-multi-tool-live` 的 latest run 仍被 `429` 限流打断，因此当前 suite 还不能按 latest 口径判定为全绿。
- 从 raw logs 看，当前 live 主要阻塞点是调用窗口和限流稳定性，而不是已经有明确证据表明 human 主逻辑发生了新回归。

### 下一步建议

- 先把 `docx-edit-autonomous-live` 与 `long-task-multi-tool-live` 重新跑到 latest 通过
- 保持 `human/basics + scenarios` 的 latest 通过面
- 在 human live 稳定后继续推进 `director/live`

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

### live

#### 证据

- `docx-edit-autonomous-live` | `20260327-175650-244` | `failed`
- `kb-answer-autonomous-live` | `20260327-180810-136` | `passed`
- `long-task-multi-tool-live` | `20260327-175650-246` | `failed`

#### 通过率

- 历史总数据：`totalRuns=10`、`passedRuns=1`、`failedRuns=9`、`historicalSuccessRate=10.0%`
- 最新总数据：`latestCaseCount=3`、`latestPassedCases=1`、`latestFailedCases=2`、`latestSuccessRate=33.3%`

#### 失败分析

- 历史 failed run 共 `9` 次：
- `long-task-multi-tool-live` | `20260327-175324-266` | `failed`
- `docx-edit-autonomous-live` | `20260327-175324-266` | `failed`
- `kb-answer-autonomous-live` | `20260327-175324-267` | `failed`
- `kb-answer-autonomous-live` | `20260327-175459-454` | `failed`
- `docx-edit-autonomous-live` | `20260327-175459-454` | `failed`
- `long-task-multi-tool-live` | `20260327-175459-454` | `failed`
- `kb-answer-autonomous-live` | `20260327-175650-245` | `failed`
- `long-task-multi-tool-live` | `20260327-175650-246` | `failed`
- `docx-edit-autonomous-live` | `20260327-175650-244` | `failed`
- 从 latest raw logs 看，`docx-edit-autonomous-live` 与 `long-task-multi-tool-live` 的失败都停在 `human.brain` 的 `structured_output_failed`，报错正文明确为 `429` 限流；`kb-answer-autonomous-live` 的 latest run 已在 `20260327-180810-136` 转为 `passed`。

#### 当前评估

- `human/live` 已经证明 KB 问答链路可以在真实模型下闭环完成。
- 但 docx 与长任务 live case 的 latest run 仍被限流中断，因此当前还没有足够 latest 证据证明 live 层整体稳定。
- 现阶段更像是 live 运行窗口与请求节流问题，而不是已经明确落到 `docx`、`kb` 或 `human` 核心节点合同的功能性回归。

#### 下一步建议

- 以更宽的请求间隔和更少的并发重新运行 `docx-edit-autonomous-live` 与 `long-task-multi-tool-live`
- 保留当前 `kb-answer-autonomous-live` 的 latest passed 作为 live 基线
- 在 `human/live` latest 通过后，再把真实模型验证继续提升到 `director/live`

## director

### 证据

- `basic-complete-terminal-state` | `20260327-181436-944` | `passed`
- `basic-context-path-smoke` | `20260327-181437-334` | `passed`
- `basic-direct-path-smoke` | `20260327-181437-336` | `passed`
- `basic-plan-path-smoke` | `20260327-181437-334` | `passed`
- `context-evidence-reuse-contract` | `20260327-181436-983` | `passed`
- `intent-context-round-cap-contract` | `20260327-181436-946` | `passed`
- `plan-exec-serial-merge-contract` | `20260327-181436-941` | `passed`
- `plan-task-shape-contract` | `20260327-181436-728` | `passed`

### 通过率

- 历史总数据：`totalRuns=24`、`passedRuns=23`、`failedRuns=1`、`historicalSuccessRate=95.8%`
- 最新总数据：`latestCaseCount=8`、`latestPassedCases=8`、`latestFailedCases=0`、`latestSuccessRate=100.0%`

### 失败分析

- 历史 failed run 共 `1` 次：
- `basic-plan-path-smoke` | `20260327-181357-716` | `failed`
- 该 failed run 的 timeline 只记录到测试断言 `synthesis objective 未正确包含计划交付与已选范围`，后续 latest run 已在 `20260327-181437-334` 转为 `passed`，因此当前 suite 没有 latest failed case。

### 当前评估

- `director` 现在已经具备 `basics + contracts` 两组正式 backend 覆盖，且 latest 口径全绿。
- `basic-direct-path-smoke`、`basic-context-path-smoke` 与 `basic-plan-path-smoke` 已分别证明 direct/context/plan 三条主路径都能稳定回到 `director_complete`。
- `context-evidence-reuse-contract`、`intent-context-round-cap-contract` 与 `plan-exec-serial-merge-contract` 已把 context 证据复用、轮次上限和串行派发/合并这些关键 orchestration 合同落成正式证据。

### 下一步建议

- 在保持 `director/basics + contracts` latest 通过面的前提下补齐 `director/live`
- 继续补强 `plan-task-shape-contract` 对“不可执行任务” fail-fast 的 raw-log 证据

### basics

#### 证据

- `basic-complete-terminal-state` | `20260327-181436-944` | `passed`
- `basic-context-path-smoke` | `20260327-181437-334` | `passed`
- `basic-direct-path-smoke` | `20260327-181437-336` | `passed`
- `basic-plan-path-smoke` | `20260327-181437-334` | `passed`

#### 通过率

- 历史总数据：`totalRuns=12`、`passedRuns=11`、`failedRuns=1`、`historicalSuccessRate=91.7%`
- 最新总数据：`latestCaseCount=4`、`latestPassedCases=4`、`latestFailedCases=0`、`latestSuccessRate=100.0%`

#### 失败分析

- 历史 failed run 共 `1` 次：
- `basic-plan-path-smoke` | `20260327-181357-716` | `failed`
- 该 case 的 latest run 已转为 `passed`，当前 group 没有 latest failed case。

#### 当前评估

- `basic-direct-path-smoke` 证明 `director_intent -> director_direct_human_exec -> director_complete` 已形成稳定默认链路。
- `basic-context-path-smoke` 证明 context human 可以把可复用证据回填到 `contextEvidence`，再回到 `director_intent` 继续后续路径。
- `basic-plan-path-smoke` 证明 `director_plan -> director_plan_exec -> director_synthesis_human -> director_complete` 的主干路径已经可以稳定回写计划结果、任务交付和最终 artifacts。
- `basic-complete-terminal-state` 证明 `director_complete` 会把 `running` 收束为 `completed`，同时不会覆盖既有 `failed/cancelled/completed` 终态。

#### 下一步建议

- 保持 `director/basics` latest 通过面
- 把当前稳定的基础编排继续提升到 `director/contracts` 与 `director/live`

### contracts

#### 证据

- `context-evidence-reuse-contract` | `20260327-181436-983` | `passed`
- `intent-context-round-cap-contract` | `20260327-181436-946` | `passed`
- `plan-exec-serial-merge-contract` | `20260327-181436-941` | `passed`
- `plan-task-shape-contract` | `20260327-181436-728` | `passed`

#### 通过率

- 历史总数据：`totalRuns=12`、`passedRuns=12`、`failedRuns=0`、`historicalSuccessRate=100.0%`
- 最新总数据：`latestCaseCount=4`、`latestPassedCases=4`、`latestFailedCases=0`、`latestSuccessRate=100.0%`

#### 失败分析

- 当前没有 failed run，因此无法给出失败模式结论。

#### 当前评估

- `context-evidence-reuse-contract` 已证明 `director_context_human` 只会从 `context_note` 的“可复用证据”区块提取高价值 evidence，而不会把整段说明原样回写。
- `intent-context-round-cap-contract` 已证明 `contextRounds` 到上限后会强制转入 `director_plan`，避免 context 循环。
- `plan-exec-serial-merge-contract` 已证明 `director_plan_exec` 会按游标串行派发，并把 plan 阶段与 synthesis 阶段的 artifacts 合并进 `finalArtifacts`。
- `plan-task-shape-contract` 的 latest raw log 当前已经覆盖 planner prompt guardrail 和空计划 fail-fast，但还没有更强的“不可执行 task”负例证据。

#### 下一步建议

- 继续补强 `plan-task-shape-contract` 的负例样本，使 raw logs 明确覆盖不可执行任务 fail-fast
- 在 contracts 稳定的前提下补齐 `director/live`
