## MODIFIED Requirements

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
