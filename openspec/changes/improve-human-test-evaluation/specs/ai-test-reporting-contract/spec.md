## MODIFIED Requirements

### Requirement: 测试框架 MUST 输出统一指标文件用于横向比较
每个测试用例 MUST 输出统一标量指标结构，至少包含耗时、步骤数、工具调用统计、审批统计、产物统计、`caseStatus`、`caseErrorCode`、`executionStatus`、`executionResultCode`，便于跨运行与跨 suite 比较；当 suite 为 `main-ai-human` 时，指标文件还 MUST 提供支持质量分级与稳定性分析的标量指标，至少包括 `toolErrorCount`、`recoveryAfterErrorCount`、`repeatedToolCallCount`、`stepBudgetUsage` 与 `qualityGrade`。

#### Scenario: 多次运行同一 human 用例
- **WHEN** 同一 human 用例被执行多次
- **THEN** 指标文件 MUST 使用统一字段结构输出每轮运行的质量等级与关键标量，以支持跨次结果比较

#### Scenario: human 任务完成但存在绕路恢复
- **WHEN** human 用例最终完成任务，但过程中出现工具失败恢复或重复调用
- **THEN** 指标文件 MUST 记录真实完成终态，并通过质量相关标量使该运行可被识别为低于无绕路完成的结果

#### Scenario: 执行未启动
- **WHEN** 用例因 fixture 缺失或 live 配置缺失而在执行前 fail-fast
- **THEN** 指标文件 MUST 将 `executionStatus` 记录为 `not_run`，并以确定性的 `caseErrorCode` 表达测试失败原因

### Requirement: 报告契约 MUST 输出结构化信号文件供后续分析器消费
测试结果契约 MUST 输出 `signals.json` 作为非标量结构化信号文件，至少包含 `toolSequence`、`toolCounts`、`toolResultCodeCounts`、`failedAssertionIds`，并在适用时包含 `scenarioTags`、`expectedOutcome` 与 suite 专有的最终动作信号；当 suite 为 `main-ai-human` 时，`signals.json` 还 MUST 输出 `taskGoal`、`maxSteps`、`approvalPolicy`、`modelName`、`resultDataKeys`、`firstFailureStage` 等评估信号，并保留与恢复行为、步数预算边界和阻塞语义判断相关的结构化输入。

#### Scenario: human 完成用例生成评估信号
- **WHEN** human 用例完成任务并返回结构化结果
- **THEN** `signals.json` MUST 同时保留任务目标、步数预算、最终动作、结果字段键名与关键步骤序列，供后续分析器判定结果质量

#### Scenario: human 阻塞用例生成阻塞评估信号
- **WHEN** human 用例以审批拒绝、工作区缺失、步数预算耗尽或证据不足等阻塞终态收敛
- **THEN** `signals.json` MUST 包含最终 human 动作、阻塞结果码、首个失败阶段与相关阻塞证据的结构化索引

#### Scenario: renderer contract 或 e2e 测试生成 UI 诊断信号
- **WHEN** renderer contract、deterministic e2e 或 ai-live e2e 用例执行用户交互与页面跳转
- **THEN** `signals.json` SHOULD 记录关键路由、用户动作、IPC 调用序列和 selector 失败信息，供后续 AI 诊断消费
