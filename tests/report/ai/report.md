# AI 域测试报告

## 1. 范围

- raw logs 来源：`tests/logs/ai/**`
- 本轮 latest 分析范围：`ai/tool/**`、`ai/human/basics/**`
- 本轮未纳入 latest 分析：`ai/human/scenarios/**`、`ai/human/live/**`、`ai/director/**`

## 2. Latest 结论

- 当前 latest 正式 backend case 共 `23` 条，`23 / 23 passed`
- `tool` suite latest `17 / 17 passed`
- `human/basics` latest `6 / 6 passed`
- 当前判断：AI 域已经从“只有工具层正式回归”推进到“工具层 + human 基础执行链路都有稳定 latest 通过面”

对应 latest run 窗口：

- `tool`：`tests/logs/ai/tool/**/20260327-170141-488 ~ 20260327-170143-790`
- `human/basics`：`tests/logs/ai/human/basics/**/20260327-164126-767 ~ 20260327-164126-775`

## 3. Tool 现状

代表性 latest 证据：

- `docx-save-overwrite-approval` | run=`20260327-170141-488` | `passed`
- `kb-evidence-search-family-contract` | run=`20260327-170143-590` | `passed`
- `terminal-risk-and-boundary-guard` | run=`20260327-170143-790` | `passed`
- `hand-tool-limit-and-artifact-merge` | run=`20260327-170141-623` | `passed`

当前判断：

- `docx / kb / terminal / hand` 四组关键契约仍保持 latest 全绿，说明进入 `human` 层后，底层工具面没有出现新的回归证据。
- `terminal-risk-and-boundary-guard` latest raw logs 仍显示越界命令直接返回 `workspace_required`，没有进入真实 step 执行。
- `hand-tool-limit-and-artifact-merge` latest raw logs 仍显示 `runtimeArtifacts` 跨 terminal/docx 工具正确合并，并在超限后写入收敛型 `watch_hint`。

当前新增的日志侧收口：

- `docx-save-overwrite-approval` latest raw logs 已显示 `meta.stats.artifacts = 2`，且 `artifacts.json` 与 `artifacts/file-artifacts/**` 同步落盘。
- `terminal-inline-edit-artifact-contract` latest raw logs 已显示 `file_artifact` 事实被回填进 `artifacts.json`，并保留 `stepId` 级 refs。

## 4. Human Basics 现状

### 4.1 证据

- `basic-brain-memory-write-boundary` | run=`20260327-164126-767` | `passed`
- `basic-delivery-mode-contract` | run=`20260327-164126-773` | `passed`
- `basic-tool-failure-recovery` | run=`20260327-164126-773` | `passed`
- `basic-learning-hand-mouth-smoke` | run=`20260327-164126-774` | `passed`
- `basic-tool-limit-converge` | run=`20260327-164126-774` | `passed`
- `basic-watchhint-retry` | run=`20260327-164126-775` | `passed`

### 4.2 当前判断

- `basic-learning-hand-mouth-smoke` 的 latest `runtime-events.jsonl` 显示完整经过 `human_brain -> human_learning -> human_hand -> human_mouth`，且中间有一次 `terminal_run_command("pwd")` 的真实工具执行，说明最基础主链路已被正式覆盖。
- `basic-watchhint-retry` 的 latest `runtime-events.jsonl` 同时保留了两类证据：
  - `watch_hint(source="memory_reducer")` 后直接回到下一次 `human_brain`
  - `watch_hint(source="hand")` 后重新选择安全命令并最终完成交付
  说明 `watchHint` 两条核心收敛路径都已经有正式 case。
- `basic-delivery-mode-contract` 的 latest `timeline.jsonl` 显示：
  - `user_answer` 输出 `# 处理结果`
  - `task_handoff` 输出 `# 子任务交付` 固定章节
  - `context_note` 输出 `# 上下文补充结果` 固定章节
  说明 `mouth` 与 `director` 的交付边界已经有稳定契约覆盖。
- `basic-tool-failure-recovery` 的 latest `runtime-events.jsonl` 显示失败的 `terminal_run_command` 结果仍被写回，并在下一轮 `human_brain` 后进入最终交付，说明基础异常不会直接打崩单任务执行链。
- `basic-brain-memory-write-boundary` 的 latest `timeline.jsonl` 明确记录：
  - 第一轮 `brain` 建立 `facts / evidences / openQuestions`
  - `hand` 后 `inside` 记忆保持不变，只新增 `lastParallelCallToolResults`、`runtimeArtifacts` 和 trace
  - 下一轮 `brain` 才继续扩展 `inside`
  说明当前最关键的 `brainMemory.inside` 写入边界已有正式证据。
- `basic-tool-limit-converge` 的 latest `runtime-events.jsonl` 显示第二次工具调用后出现 `watch_hint("hand 累计工具调用次数达到 2，已超过临时上限 1...")`，随后进入最终交付，没有继续追加工具调用，说明超限收敛保护已正式落地。

### 4.3 本轮对齐差异

- `basic-tool-failure-recovery` 在较早 run `20260327-164036-153` 曾失败。
- 失败原因不是 case 定义错误，而是 `toolExecutionOverride` 注入失败结果时没有把 `toolName` 规范化写回 `lastParallelCallToolResults`。
- latest run `20260327-164126-773` 已转为 `passed`，说明当前 `human` 失败恢复链路与工具结果契约已重新对齐。

## 5. 剩余风险与下一步

- `human/scenarios`、`human/live` 与 `director` 正式 case 仍未形成正式 latest 覆盖，AI 域整体闭环还没有推进到复杂任务与编排层。
- `artifacts.json` 当前已能稳定索引 backend `file_artifact` 实体附件，但更细的语义信息仍以 `runtime-events.jsonl` 为准。

建议的下一阶段顺序：

1. 先补 `human/scenarios`
2. 再补 `human/live`
3. 然后推进 `director/basics` 与 `director/contracts`
