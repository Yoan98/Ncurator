## Context

当前 AI 测试报告由 `tests/ai/harness/reporter.ts` 统一写入 `events.jsonl`、`assertions.json`、`metrics.json`、`summary.md`。其中：

- `events.jsonl` 是原始事件流，信息完整，但消费成本高。
- `assertions.json` 只记录断言列表与最终通过/失败状态。
- `metrics.json` 除基础统计外，还混入了 `failure_category`、`suspected_root_cause`、`optimization_hints` 等固定分析字段。
- `summary.md` 将这些固定分析字段再次转写为 Markdown。

该设计存在三个问题：

1. 分析字段不是从原始证据推导出来的，而是由 harness 根据 `passed/failed` 写死模板文本，无法代表真实执行语义。
2. 报告没有区分“case 自己是否通过”和“被测系统实际执行结果”。在负向测试中，`case passed` 与 `execution blocked` 会被混淆。
3. 后续希望由 Codex 读取整批报告做诊断与优化建议，因此报告更需要稳定、确定性的结构化输入，而不是单次运行的伪分析结论。

这次变更会同时影响 capability 与 human-live 两类测试。两者共享同一套报告写入器，但 execution 语义来源不同：

- human-live 可直接从 `HumanTaskOutput` 提取执行状态与结果码。
- capability 用例直接调用生产工具入口，没有统一任务结果类型，需要额外设计报告注入点来表达执行语义。

## Goals / Non-Goals

**Goals:**

- 将测试报告收敛为“原始证据 + 结构化信号 + 事实摘要”三层模型，移除固定分析文案。
- 在报告契约中明确区分 `caseStatus` 与 `executionOutcome`，支持正向、负向、阻塞、显式能力缺口等场景。
- 为后续 Codex 批量分析提供稳定输入，至少覆盖失败断言、工具序列、工具结果码、审批统计、产物统计、执行状态等核心信号。
- 让 capability 与 human-live 两套 harness 都输出统一的报告主 schema，降低后续聚合器复杂度。
- 保持 `events.jsonl` 作为最高保真证据来源，不改变现有 AI 运行时事件模型。

**Non-Goals:**

- 本次不实现“自动生成优化建议”的 batch analyzer；该能力留给后续 Codex 或独立分析脚本。
- 本次不追求为所有历史报告目录做兼容迁移；旧报告可继续保留，新运行生成新契约。
- 本次不修改 AI runtime 的事件定义与事件发送链路，除非为了补齐极少量确定性统计而必须调整。
- 本次不重构具体测试 case 的业务断言逻辑，只调整其报告声明与消费方式。

## Decisions

### 1. 报告采用“三层结构”，移除固定分析字段

新的报告结构划分为：

- `events.jsonl`：原始证据层，保持逐事件回放能力。
- `assertions.json`：断言结果层，记录 case verdict、失败断言与断言明细。
- `metrics.json`：标量聚合层，记录耗时、步骤数、审批次数、产物次数、case 状态、execution 状态等确定性指标。
- `signals.json`：非标量结构化信号层，记录工具序列、按工具聚合的结果码、标签、失败断言 ID、最终 human 动作等。
- `summary.md`：事实摘要层，只转写关键信号，不再包含根因或优化建议。

选择该方案的原因：

- 让“证据”和“解释”解耦，避免将伪分析写死进报告。
- 保留对人类友好的摘要，同时确保程序消费优先读取 JSON。
- `signals.json` 可以容纳 `toolSequence`、`toolResultCodeCounts` 等结构化数据，避免把复杂对象硬塞进 `metrics.json`。

考虑过的替代方案：

- 保留现有 `analysis` 字段但改成空字符串或 `none`：仍然保留错误语义，且没有信息增量。
- 将所有新信号都塞进 `metrics.json`：会让标量指标与复杂对象混杂，降低可读性与稳定性。

### 2. 显式拆分 case verdict 与 execution outcome

统一引入两组语义：

- `caseStatus` / `caseErrorCode`
  - 表达测试 case 自己是否成功执行完成，以及如果失败，失败属于 fixture 缺失、断言失败、环境缺失还是运行时异常。
- `executionStatus` / `executionResultCode`
  - 表达被测系统在该用例中的实际执行语义，如 `completed`、`blocked`、`failed`、`not_run`，以及对应结果码。

推荐的基础分类：

- `caseStatus`: `passed | failed`
- `caseErrorCode`: `none | fixture_missing | live_config_missing | assertion_failed | runtime_exception`
- `executionStatus`: `completed | blocked | failed | not_run | unknown`

其中：

- human-live 由 `HumanTaskOutput` 自动填充 `executionStatus` / `executionResultCode`。
- capability 通过新的 harness 注入点声明 execution outcome；如果 case 未声明，则落为 `unknown`，推动后续逐步补齐。

选择该方案的原因：

- 能正确表达“审批拒绝型 case 通过，但 execution 被阻塞”的语义。
- 避免后续分析器把负向测试误判成“系统正常完成”或“报告无失败”。

考虑过的替代方案：

- 沿用单一 `status` 字段：无法表达 case verdict 与业务执行的分离。
- 仅保留 `executionResultCode` 不保留 `caseErrorCode`：会丢失测试 harness 自身失败的诊断能力。

### 3. 事件聚合逻辑集中在 reporter 层，case 只声明少量元信息

报告生成分成两部分：

- reporter 从 `events.jsonl` 与断言结果统一推导通用信号：
  - `toolCallCount`
  - `approvalRequiredCount` / `approvalApprovedCount` / `approvalDeniedCount`
  - `fileArtifactCount`
  - `toolSequence`
  - `toolCounts`
  - `toolResultCodeCounts`
  - `failedAssertionIds`
- case/harness 仅补充 reporter 无法从事件中可靠推导的信息：
  - `executionStatus` / `executionResultCode`
  - `scenarioTags`
  - `expectedOutcome`
  - capability 专有的执行语义说明

这要求在 harness 层新增统一的 `CaseReportSignals` / `CaseExecutionOutcome` 类型，并在 `runCapabilityCase`、`runHumanLiveCase` 中汇总后交给 reporter。

选择该方案的原因：

- 把通用推导留在中心化组件，降低每个 case 重复造轮子。
- 保证同类指标在 capability 与 human-live 之间有一致口径。

考虑过的替代方案：

- 让每个 case 自己手工填写全部 signals：灵活但不一致，维护成本高。
- 仅从事件自动推导所有字段：capability 缺少统一任务输出，无法可靠表达最终 execution outcome。

### 4. capability 与 human-live 采用同一主 schema，但允许不同信号来源

统一后的主 schema 适用于两个 suite：

- 共同字段：`suite`、`caseId`、`runId`、`taskId`、`caseStatus`、`caseErrorCode`、`executionStatus`、`executionResultCode`、统计指标、断言摘要、工具信号。
- human-live 专有字段：`finalHumanAction`、`humanStepCount`、与 `HumanTaskOutput` 对齐的结果摘要。
- capability 专有字段：通过 case 注入的 execution outcome，以及必要时的 `expectedOutcome` / `scenarioTags`。

这意味着读取器 `reportInspector` 也要升级为读取统一 schema，而不是只读取旧的 `metrics.failure_category`。

选择该方案的原因：

- 统一下游消费接口，后续 Codex 不需要按 suite 写两套解析逻辑。
- 保留 suite 差异，但将差异压缩到局部扩展字段。

考虑过的替代方案：

- 为 capability 与 human-live 维护两套完全独立的报告格式：会增加后续分析器复杂度。

### 5. 以破坏式契约升级替换兼容别名

本次变更不保留 `failure_category`、`suspected_root_cause`、`optimization_hints` 作为兼容别名，也不在新报告中写入占位空值。

迁移方式：

- 更新 harness 类型、落盘逻辑、读取逻辑与依赖旧字段的测试。
- 更新 `doc/testing.md`、`tests/ai/README.md` 与对应 specs。
- 历史报告目录不迁移，作为旧契约产物保留。

选择该方案的原因：

- 报告产物是测试执行生成物，不是长期对外 API；保持新契约纯净比兼容旧字段更重要。
- 兼容别名会继续让消费者误用旧语义，延长契约混乱期。

考虑过的替代方案：

- 新旧字段并存一段时间：迁移风险更低，但会持续制造语义冲突。

## Risks / Trade-offs

- [Risk] capability 用例的 execution outcome 没有统一来源，初期可能出现大量 `unknown`。 → Mitigation：在 harness 中引入显式注入点，并优先补齐现有高价值 capability case。
- [Risk] 新增 `signals.json` 后，报告文件数量增多，维护成本上升。 → Mitigation：限制 `signals.json` 只承载后续分析真正需要的结构化信号，避免复制 `events.jsonl` 全量内容。
- [Risk] 破坏式改动会让依赖旧字段的测试或脚本失效。 → Mitigation：同步更新 `reportInspector`、fail-fast 回归用例和 README/spec 文档，在一个变更中完成全量切换。
- [Risk] 仅保留数据可能让人类直接阅读报告时感知门槛升高。 → Mitigation：保留 `summary.md`，但其内容严格从结构化信号生成，提供事实摘要而非推断。
- [Risk] 事件聚合算法如果设计不当，可能把多步工具链误解为最终结论。 → Mitigation：将“可自动推导”和“需要 case 明确声明”的字段分离，避免 reporter 过度猜测。

## Migration Plan

1. 在 `tests/ai/harness/types.ts` 中引入新的报告类型，移除旧的 `CaseAnalysis` 结构。
2. 重写 `reporter.ts` 的落盘逻辑，新增 `signals.json`，并将 `summary.md` 改为事实摘要模板。
3. 在 `runCapabilityCase` 与 `runHumanLiveCase` 中接入新的 `caseErrorCode` 与 `executionOutcome` 采集逻辑。
4. 更新 `reportInspector.ts` 与依赖旧字段的回归测试，改为断言新 schema。
5. 更新 `doc/testing.md`、`tests/ai/README.md` 与相关 OpenSpec specs，使文档与实现口径一致。
6. 不迁移历史 `tests/report/**` 目录；新执行生成的新报告自然使用新格式。
7. 如需回滚，只需回退 harness 与文档变更并重新执行测试，无需做数据回滚。

## Open Questions

- capability 用例的 `executionOutcome` 最终采用“显式注入 API”还是“由 execute 返回结构中约定字段”作为标准入口，仍需在实现前确定。
- `signals.json` 是否需要收录 `warningMessages` 原文，还是只保留 `warningCount` 与让消费者回读 `events.jsonl`，需要在实现复杂度与消费便利性之间取舍。
- `summary.md` 是否要包含 `expectedOutcome` / `scenarioTags`，还是只保留运行结果摘要，仍可在实现时根据可读性再收敛一次。
