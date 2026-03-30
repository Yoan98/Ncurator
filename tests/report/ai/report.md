# AI 域测试报告

## 总览

### 分析范围

- raw logs 范围：当前仓库内 `tests/logs/ai/**`
- 本次分析窗口：当前仓库内 AI 域全部 raw runs
- 本次纳入分析的 suite：`tool`、`human`、`director`
- 本次纳入分析的 groups：`tool/docx`、`tool/kb`、`tool/terminal`、`tool/hand`、`human/basics`、`human/scenarios`、`human/live`、`director/basics`、`director/contracts`、`director/live`

### 总体结论

- 历史总数据：`totalRuns=151`、`passedRuns=125`、`failedRuns=26`、`historicalSuccessRate=82.8%`
- 最新总数据：`latestCaseCount=39`、`latestPassedCases=34`、`latestFailedCases=5`、`latestSuccessRate=87.2%`
- 当前结论：`tool` suite 与 `director/basics + contracts` 仍保持 latest 全绿；当前 latest failed case 已扩大为 `human/live` 的 `kb-answer-autonomous-live`、`docx-edit-autonomous-live`、`long-task-multi-tool-live`，以及 `director/live` 的 `simple-task-human-first-live`、`complex-task-plan-and-synthesis-live`。本轮 live 输入已改成自然诉求，执行层也已切到串行 + 统一 limiter/backoff，最新 raw logs 不再以“脚本化提示词”或单纯 `429` 为主导。按最新证据分层归因：`simple-task-human-first-live` 在 `human.mouth` 结构化输出处被 `503` 阻塞，属于`环境阻塞`；其余 4 条 case 主要暴露 `human` 的 KB/docx 工具选择与参数构造偏差，以及 `director` planner 产出不可访问 workspace 风格路径后仍把任务收束为 completed 的`实现行为偏差`；当前没有新的主导性`case 设计偏差`证据。

### 下一阶段建议

- 保持当前 `human/live` 与 `director/live` 的串行执行、统一 limiter 与 backoff 方案，不再回退到脚本化 live 提示
- 优先修 `human` 的 KB 工具路由、`docx_apply_ops` 参数构造，以及 `director` planner 的 workspace 路径与任务完成判据
- 为 `human.mouth` 的结构化输出补充 `503/429` 级别的重试或降级策略
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
- `docx-edit-autonomous-live` | `20260330-124948-837` | `failed`
- `kb-answer-autonomous-live` | `20260330-124826-859` | `failed`
- `long-task-multi-tool-live` | `20260330-124456-793` | `failed`
- `multi-tool-collaboration-simulated` | `20260327-173741-685` | `passed`

### 通过率

- 历史总数据：`totalRuns=40`、`passedRuns=23`、`failedRuns=17`、`historicalSuccessRate=57.5%`
- 最新总数据：`latestCaseCount=12`、`latestPassedCases=9`、`latestFailedCases=3`、`latestSuccessRate=75.0%`

### 失败分析

- 历史 failed run 共 `17` 次：
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
- `long-task-multi-tool-live` | `20260330-124456-793` | `failed`
- `kb-answer-autonomous-live` | `20260330-124826-859` | `failed`
- `docx-edit-autonomous-live` | `20260330-124948-837` | `failed`
- 最新 3 条 `human/live` raw log 已不再以 `429` 为主导：`kb-answer-autonomous-live` 误学成 `workspace-cli/docx-read` 并在无 workspace 绑定下尝试 terminal；`docx-edit-autonomous-live` 与 `long-task-multi-tool-live` 都能走到 docx 读取/定位，但 `docx_apply_ops` 参数连续触发 `invalid_input`，没有完成真实写入与 preview。

### 当前评估

- `human/basics` 与 `human/scenarios` 仍保持 latest 全绿，说明基础主链路、`watchHint` 收敛、`deliveryMode` 契约、失败恢复、记忆写入边界、复杂 docx 编辑、多工具联动与审批拒绝收敛仍然稳定。
- `human/live` 的 3 条 latest run 现在全部失败，且失败形态已经从“起手限流”转成“工具选择与参数构造偏差”：`kb-answer-autonomous-live` 没走到 KB 工具链，`docx-edit-autonomous-live` 与 `long-task-multi-tool-live` 都卡在 docx 写入参数 schema。
- 从最新 raw logs 看，当前 `human` 的 live 问题已经主要落到`实现行为偏差`，而不是 `tool` 契约回归，也不是单纯的 live 限流窗口问题。

### 下一步建议

- 优先修正 `human` 在 live 下的 KB skill 选择与 workspace 依赖，避免单纯问答误退到 terminal/workspace-cli
- 优先补强 `docx-write` skill 与 `docx_apply_ops` 的参数可用性，确保模型能构造出合法写入请求
- 保持 `human/basics + scenarios` 的 latest 通过面
- 在 `human/live` 行为修复后继续重跑 `director/live`

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

- `docx-edit-autonomous-live` | `20260330-124948-837` | `failed`
- `kb-answer-autonomous-live` | `20260330-124826-859` | `failed`
- `long-task-multi-tool-live` | `20260330-124456-793` | `failed`

#### 通过率

- 历史总数据：`totalRuns=14`、`passedRuns=2`、`failedRuns=12`、`historicalSuccessRate=14.3%`
- 最新总数据：`latestCaseCount=3`、`latestPassedCases=0`、`latestFailedCases=3`、`latestSuccessRate=0.0%`

#### 失败分析

- 历史 failed run 共 `12` 次：
- `long-task-multi-tool-live` | `20260327-175324-266` | `failed`
- `docx-edit-autonomous-live` | `20260327-175324-266` | `failed`
- `kb-answer-autonomous-live` | `20260327-175324-267` | `failed`
- `kb-answer-autonomous-live` | `20260327-175459-454` | `failed`
- `docx-edit-autonomous-live` | `20260327-175459-454` | `failed`
- `long-task-multi-tool-live` | `20260327-175459-454` | `failed`
- `kb-answer-autonomous-live` | `20260327-175650-245` | `failed`
- `long-task-multi-tool-live` | `20260327-175650-246` | `failed`
- `docx-edit-autonomous-live` | `20260327-175650-244` | `failed`
- `long-task-multi-tool-live` | `20260330-124456-793` | `failed`
- `kb-answer-autonomous-live` | `20260330-124826-859` | `failed`
- `docx-edit-autonomous-live` | `20260330-124948-837` | `failed`
- `kb-answer-autonomous-live` 的 latest run 不再是 `429`，而是先误学成 `workspace-cli/docx-read`，随后因未绑定 workspace 调用 terminal 失败，最终在 0 次 KB 工具调用下收口。
- `docx-edit-autonomous-live` 的 latest run 已能走到 `docx_open + docx_search`，但 `docx_apply_ops` 因 `ops[0].type` schema 不匹配失败，没有继续到 preview。
- `long-task-multi-tool-live` 的 latest run 已完成 KB 检索与占位符定位，但两次 `docx_apply_ops` 分别因为 `query` 与 `replace` 缺失而失败，最终停在“有证据、无写入”状态。

#### 当前评估

- 本轮 live case 输入已经改成自然诉求，执行层也已切到串行 + 统一 limiter/backoff；最新失败已不再由脚本化提示或单纯限流主导。
- `human/live` 当前最清晰的风险点是两类实现行为偏差：一类是 KB 问答没有稳定走到 KB 工具链，另一类是 docx 写入参数 schema 对模型不够可用。
- 当前没有任何 latest passed 证据可以继续作为 `human/live` 基线，因此 live 组仍不能视为稳定正式回归面。

#### 下一步建议

- 保持当前自然诉求输入与串行 live runner，不再回退到内部路径脚本化提示
- 先修 `kb-answer-autonomous-live` 的 KB 路由与 workspace 依赖，再修 `docx-edit-autonomous-live` / `long-task-multi-tool-live` 的 docx 写入参数问题
- 在 `human/live` 出现新的 latest passed 证据后，再继续把真实模型验证提升到 `director/live`

## director

### 证据

- `basic-complete-terminal-state` | `20260327-185401-071` | `passed`
- `basic-context-path-smoke` | `20260327-185359-782` | `passed`
- `basic-direct-path-smoke` | `20260327-185400-043` | `passed`
- `basic-plan-path-smoke` | `20260327-185359-515` | `passed`
- `complex-task-plan-and-synthesis-live` | `20260330-125342-169` | `failed`
- `context-evidence-reuse-contract` | `20260327-185400-685` | `passed`
- `intent-context-round-cap-contract` | `20260327-185400-477` | `passed`
- `plan-exec-serial-merge-contract` | `20260327-185400-275` | `passed`
- `plan-task-shape-contract` | `20260327-185400-859` | `passed`
- `simple-task-human-first-live` | `20260330-125951-031` | `failed`

### 通过率

- 历史总数据：`totalRuns=44`、`passedRuns=39`、`failedRuns=5`、`historicalSuccessRate=88.6%`
- 最新总数据：`latestCaseCount=10`、`latestPassedCases=8`、`latestFailedCases=2`、`latestSuccessRate=80.0%`

### 失败分析

- 历史 failed run 共 `5` 次：
- `basic-plan-path-smoke` | `20260327-181357-716` | `failed`
- `simple-task-human-first-live` | `20260327-182441-832` | `failed`
- `complex-task-plan-and-synthesis-live` | `20260327-182441-833` | `failed`
- `complex-task-plan-and-synthesis-live` | `20260330-125342-169` | `failed`
- `simple-task-human-first-live` | `20260330-125951-031` | `failed`
- `basic-plan-path-smoke` 的失败来自早期测试断言过严，latest run 已转为 `passed`；两条 `director/live` 的最新 raw log 已不再同时表现为 `429`。其中 `complex-task-plan-and-synthesis-live` 暴露的是 planner / task 执行行为偏差，`simple-task-human-first-live` 则是 simple summary 误进 plan 后又在 `human.mouth` 结构化输出处遭遇 `503`。

### 当前评估

- `director` 现在已经具备 `basics + contracts` 两组稳定正式 backend 覆盖，但 `live` 组 latest 仍未恢复。
- `basic-direct-path-smoke`、`basic-context-path-smoke` 与 `basic-plan-path-smoke` 已分别证明 direct/context/plan 三条主路径都能稳定回到 `director_complete`。
- `context-evidence-reuse-contract`、`intent-context-round-cap-contract` 与 `plan-exec-serial-merge-contract` 已把 context 证据复用、轮次上限和串行派发/合并这些关键 orchestration 合同落成正式证据。
- `director/live` 的最新问题已经从“嵌套 human 被限流打断”转成“环境阻塞 + 实现行为偏差混合”：`complex-task-plan-and-synthesis-live` 能进入增强路径，但 planner 把 `workspace:test-workspace` 风格路径直接写进 task，后续 docx/terminal 步骤无法访问 yet 仍被收束为 completed；`simple-task-human-first-live` 仍把单文件摘要误升级为 plan，并在重复读取后于 `human.mouth` 遭遇 `503`。

### 下一步建议

- 在保持 `director/basics + contracts` latest 通过面的前提下，优先修复 `director/live` 的 simple-task 路由偏差、planner 路径现实性与任务完成判据
- 为 `human.mouth` 的结构化输出补充 `503` 级别的重试或降级策略
- 继续补强 `plan-task-shape-contract` 对“不可执行任务” fail-fast 的 raw-log 证据

### basics

#### 证据

- `basic-complete-terminal-state` | `20260327-185401-071` | `passed`
- `basic-context-path-smoke` | `20260327-185359-782` | `passed`
- `basic-direct-path-smoke` | `20260327-185400-043` | `passed`
- `basic-plan-path-smoke` | `20260327-185359-515` | `passed`

#### 通过率

- 历史总数据：`totalRuns=20`、`passedRuns=19`、`failedRuns=1`、`historicalSuccessRate=95.0%`
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

- `context-evidence-reuse-contract` | `20260327-185400-685` | `passed`
- `intent-context-round-cap-contract` | `20260327-185400-477` | `passed`
- `plan-exec-serial-merge-contract` | `20260327-185400-275` | `passed`
- `plan-task-shape-contract` | `20260327-185400-859` | `passed`

#### 通过率

- 历史总数据：`totalRuns=20`、`passedRuns=20`、`failedRuns=0`、`historicalSuccessRate=100.0%`
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

### live

#### 证据

- `complex-task-plan-and-synthesis-live` | `20260330-125342-169` | `failed`
- `simple-task-human-first-live` | `20260330-125951-031` | `failed`

#### 通过率

- 历史总数据：`totalRuns=4`、`passedRuns=0`、`failedRuns=4`、`historicalSuccessRate=0.0%`
- 最新总数据：`latestCaseCount=2`、`latestPassedCases=0`、`latestFailedCases=2`、`latestSuccessRate=0.0%`

#### 失败分析

- 历史 failed run 共 `4` 次：
- `simple-task-human-first-live` | `20260327-182441-832` | `failed`
- `complex-task-plan-and-synthesis-live` | `20260327-182441-833` | `failed`
- `simple-task-human-first-live` | `20260330-125951-031` | `failed`
- `complex-task-plan-and-synthesis-live` | `20260330-125342-169` | `failed`
- `complex-task-plan-and-synthesis-live` 的 latest run 已证明增强路径本身能走通，但 plan 里第 2/3/4 个 task 直接带入 `workspace:test-workspace` 风格 docx/cwd 路径，导致后续只拿到 KB 命中与一次 `docx_open`，没有实际 preview artifact，却仍被收束为 completed。
- `simple-task-human-first-live` 的 latest run 仍然先 `plan_created` 再进入单 task plan_exec；task human 虽然多次成功读取到了 `director-simple-live.txt` 内容，却反复把正文读取当成“仅成功摘要”，最后在 `human.mouth` 结构化输出时遭遇 `503 Service temporarily unavailable`。

#### 当前评估

- `director/live` 的最新失败已不再是单一的限流噪音，反而更清楚地暴露了 simple-task 误进 plan、planner 产出不可访问路径、以及 task 完成态与真实 artifact 产出脱节的问题。
- 当前 `director/live` 仍混有环境阻塞证据，但主要回归面已经转成实现行为质量，而不是 case 设计。
- 在这些问题稳定前，`director/live` 仍不能视为已形成正式回归面。

#### 下一步建议

- 保持当前自然诉求输入与串行 live runner，继续把环境阻塞与实现偏差分开记录
- 先修 `simple-task-human-first-live` 的 human-first 路由质量，再修 `complex-task-plan-and-synthesis-live` 的 planner 路径与 artifacts 完成判据
- 等 `director/live` 拿到新的 latest passed 证据后，再把 `director` suite 视为完整闭环
