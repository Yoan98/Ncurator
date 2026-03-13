# ai-test-reporting-contract Specification

## Purpose
TBD - created by archiving change add-script-first-ai-testing-harness. Update Purpose after archive.
## Requirements
### Requirement: 测试框架 MUST 输出可回放事件流与结构化断言结果
每个测试用例执行后 MUST 输出完整事件流与结构化断言结果，确保结果可回放、可审计、可定位；当运行涉及 task delivery 或 human 最终答复时，事件流 MUST 保留相应的交付事件与最终答复来源，使测试能够区分 direct human、plan 业务任务交付与 synthesis human 收口。

#### Scenario: 用例执行完成
- **WHEN** 任一 capability、runtime 或 human 用例结束
- **THEN** 系统 MUST 产出完整事件流与断言结果，且两者可按 `suite/caseId/runId/taskId` 关联

#### Scenario: task delivery 事件可回放
- **WHEN** human 用例或 runtime 用例生成了中间任务交付或最终答复
- **THEN** 报告中的事件流 MUST 保留 task delivery 事件与最终 answer stream 来源，以支持后续回放和断言

#### Scenario: 用例失败定位
- **WHEN** 用例断言失败
- **THEN** 报告 MUST 提供对应失败断言 ID、断言明细、关联事件片段与关键上下文字段

### Requirement: 测试框架 MUST 输出统一指标文件用于横向比较
每个测试用例 MUST 输出统一标量指标结构，至少包含耗时、步骤数、工具调用统计、审批统计、产物统计、`caseStatus`、`caseErrorCode`、`executionStatus`、`executionResultCode`；当 suite 为 `main-ai-human` 时，指标文件还 MUST 提供 `toolErrorCount`、`recoveryAfterErrorCount`、`repeatedToolCallCount`、`stepBudgetUsage`、`qualityGrade`，以及交付相关标量，例如 `taskDeliveryCount`、`finalDeliveryMode`、`finalDeliverySource` 与 `synthesisTriggered`；当 suite 为 `main-ai-runtime` 且用例关注 `main context` 路径时，指标文件还 MUST 支持输出 context 专属标量，至少包括 `contextRoundCount`、`contextEvidenceCount`、`internalContextDeliveryCount`、`contextFinalRoute` 与 `fellBackByRoundCap`。

#### Scenario: 多次运行同一用例
- **WHEN** 同一 capability、runtime 或 human 用例被执行多次
- **THEN** 指标文件 MUST 使用统一字段结构，以支持跨次结果比较

#### Scenario: direct human 生成最终答复
- **WHEN** `main-ai-human` 用例通过 direct human 完成并输出最终答复
- **THEN** 指标文件 MUST 记录该次运行的最终交付模式和最终答复来源，而不是仅记录完成终态

#### Scenario: plan 任务完成但存在中间交付
- **WHEN** plan 路径中存在多个业务任务交付并最终进入 synthesis human
- **THEN** 指标文件 MUST 记录交付数量、是否触发 synthesis，以及最终答复来自 synthesis 而非业务子任务

#### Scenario: human 任务完成但存在绕路恢复
- **WHEN** human 用例最终完成任务，但过程中出现工具失败恢复或重复调用
- **THEN** 指标文件 MUST 记录真实完成终态，并通过质量相关标量使该运行可被识别为低于无绕路完成的结果

#### Scenario: main context 用例记录轮次与降级结果
- **WHEN** `main-ai-runtime` 的 context 用例完成一次 deterministic 或 live 运行
- **THEN** 指标文件 MUST 能稳定表达本次运行使用的 context 轮次、最终路由以及是否因轮次上限被迫降级

#### Scenario: 执行未启动
- **WHEN** 用例因 fixture 缺失或 live 配置缺失而在执行前 fail-fast
- **THEN** 指标文件 MUST 将 `executionStatus` 记录为 `not_run`，并以确定性的 `caseErrorCode` 表达测试失败原因

### Requirement: 报告落盘路径与命名 MUST 标准化

测试结果 MUST 按统一目录层级落盘到 `tests/report/<suite>/<case>/<timestamp>/` 下，并包含标准文件集合 `events.jsonl`、`assertions.json`、`metrics.json`、`signals.json`、`summary.md`，避免结果覆盖并支持历史追踪；当 suite 属于 renderer contract 或 e2e 测试时，系统 MAY 在同级目录附加 UI 证据文件或子目录（如截图、trace、console、DOM snapshot），但 MUST NOT 替代标准文件集合。

#### Scenario: 生成 capability 用例报告

- **WHEN** capability 用例执行结束
- **THEN** 报告 MUST 写入 `tests/report/<suite>/<case>/<timestamp>/` 下的标准文件集合

#### Scenario: 生成 human 用例报告

- **WHEN** human 用例执行结束
- **THEN** 报告 MUST 与 capability 用例使用同一目录规范并可区分 suite 类型

#### Scenario: 生成 e2e 用例报告

- **WHEN** deterministic e2e 或 ai-live e2e 用例执行结束
- **THEN** 报告 MUST 写入标准文件集合，并在适用时附带截图、trace 或其他 UI 证据文件

### Requirement: 报告契约 MUST 输出结构化信号文件供后续分析器消费
测试结果契约 MUST 输出 `signals.json` 作为非标量结构化信号文件，至少包含 `toolSequence`、`toolCounts`、`toolResultCodeCounts`、`failedAssertionIds`；当 suite 为 `main-ai-human` 时，`signals.json` 还 MUST 输出 `taskGoal`、`maxSteps`、`approvalPolicy`、`modelName`、`resultDataKeys`、`firstFailureStage`，并新增交付相关信号，例如 `taskDeliveryTaskIds`、`deliverySectionKeys`、`finalDeliveryTaskId` 与 `finalDeliveryMode`；当 suite 为 `main-ai-runtime` 且用例关注 `main context` 路径时，`signals.json` 还 MUST 支持输出 `contextDecisionSequence`、`internalContextTaskIds`、`contextEvidenceItems`、`effectiveContextEvidenceAdded` 与 `contextResolutionStatus` 等结构化信号。

#### Scenario: 多工具用例生成结构化信号
- **WHEN** capability 或 human 用例执行多个工具步骤
- **THEN** `signals.json` MUST 保留工具调用顺序、按工具聚合的调用次数与结果码统计

#### Scenario: human 完成用例生成交付评估信号
- **WHEN** human 用例完成任务并返回正式交付
- **THEN** `signals.json` MUST 同时保留任务目标、步数预算、最终动作、任务交付来源与关键交付 section 信息，供后续分析器判定结果质量

#### Scenario: human 阻塞用例生成阻塞评估信号
- **WHEN** human 用例以审批拒绝、工作区缺失、步数预算耗尽或证据不足等阻塞终态收敛
- **THEN** `signals.json` MUST 包含最终 human 动作、阻塞结果码、首个失败阶段与相关阻塞证据的结构化索引

#### Scenario: plan synthesis 生成最终交付信号
- **WHEN** runtime 用例在多个业务任务后进入 synthesis human 并产出最终答复
- **THEN** `signals.json` MUST 标记最终交付来自 synthesis 路径，并关联全部中间任务交付的 taskId 列表

#### Scenario: main context 用例生成轮次与证据信号
- **WHEN** runtime 用例执行 `need_context` 往返并写回 `contextEvidence`
- **THEN** `signals.json` MUST 能表达决策序列、internal context 任务身份、最终保留的 context evidence，以及这些 evidence 是否真正改变了后续路由

### Requirement: 摘要文件 MUST 仅转写事实性报告信号
`summary.md` MUST 只转写结构化报告中的事实性信号，用于人工快速阅读；摘要文件 MUST NOT 预写根因推断、优化建议或其他解释性分析文本。

#### Scenario: 生成事实摘要
- **WHEN** 任一测试用例完成并写入摘要文件
- **THEN** 摘要 MUST 仅包含 suite、caseStatus、executionStatus、关键统计与失败断言等事实信息

#### Scenario: 读取摘要进行人工核对
- **WHEN** 开发者查看 `summary.md`
- **THEN** 其内容 MUST 与 `assertions.json`、`metrics.json`、`signals.json` 保持一致，且不包含固定根因或优化建议段落

### Requirement: 报告契约 MUST 与 case catalog 稳定关联且不得定义当前 case inventory
测试报告契约 MUST 继续为每次执行输出历史证据目录，但报告目录本身 MUST NOT 被解释为“当前测试全集”；所有报告消费方 MUST 先读取 case catalog，再通过 `suite`、`caseId` 与 latest report 关联字段定位对应报告。

#### Scenario: 读取 active case 的最新报告
- **WHEN** AI 或分析脚本需要读取某个当前 case 的最新执行结果
- **THEN** 系统 MUST 先通过 catalog 确认该 case 的当前状态，再定位 latest report，而不是直接扫描报告目录猜测 case 是否仍然有效

#### Scenario: 报告目录中存在 stale case
- **WHEN** `tests/report/**` 中保留了已废弃或已重命名 case 的历史目录
- **THEN** 系统 MUST 将这些目录视为历史证据，而不是自动纳入当前 case inventory

### Requirement: 报告分析器 MUST 基于 catalog 推断 suite 的当前 case 集
任何对测试报告做聚合、对比、批次分析或摘要生成的脚本 MUST 基于 catalog 判定当前 suite 的 case 集，而不是通过扫描报告目录或汇总文件自行推断。

#### Scenario: 运行 human assessment 分析
- **WHEN** 系统为 `main-ai-human` 生成 assessment 或 batch summary
- **THEN** 分析器 MUST 以 catalog 中当前有效的人类测试 case 集作为输入边界

#### Scenario: 生成 capability 或 UI suite 摘要
- **WHEN** 系统对 capability、renderer 或 e2e suite 生成聚合视图
- **THEN** 聚合逻辑 MUST 过滤掉 catalog 中不存在或已标记为非 active 的历史报告目录

