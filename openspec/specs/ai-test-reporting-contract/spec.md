# ai-test-reporting-contract Specification

## Purpose
TBD - created by archiving change add-script-first-ai-testing-harness. Update Purpose after archive.
## Requirements
### Requirement: 测试框架 MUST 输出可回放事件流与结构化断言结果
每个测试用例执行后 MUST 输出完整事件流与结构化断言结果，确保结果可回放、可审计、可定位；断言结果 MUST 明确包含 `suite`、`caseId`、`runId`、`taskId`、`caseStatus`、断言总数、失败断言 ID 与断言明细。

#### Scenario: 用例执行完成
- **WHEN** 任一 capability 或 human 用例结束
- **THEN** 系统 MUST 产出事件流文件与断言结果文件，且两者可按 `suite/caseId/runId/taskId` 关联

#### Scenario: 用例失败定位
- **WHEN** 用例断言失败
- **THEN** 报告 MUST 提供对应失败断言 ID、断言明细、关联事件片段与关键上下文字段

### Requirement: 测试框架 MUST 输出统一指标文件用于横向比较
每个测试用例 MUST 输出统一标量指标结构，至少包含耗时、步骤数、工具调用统计、审批统计、产物统计、`caseStatus`、`caseErrorCode`、`executionStatus`、`executionResultCode`，便于跨运行与跨 suite 比较；当 suite 为 `main-ai-human` 时，指标文件还 MUST 提供支持质量分级与稳定性分析的标量指标，至少包括 `toolErrorCount`、`recoveryAfterErrorCount`、`repeatedToolCallCount`、`stepBudgetUsage` 与 `qualityGrade`。

#### Scenario: 多次运行同一用例
- **WHEN** 同一用例被执行多次
- **THEN** 指标文件 MUST 使用统一字段结构，以支持跨次结果比较

#### Scenario: 多次运行同一 human 用例
- **WHEN** 同一 human 用例被执行多次
- **THEN** 指标文件 MUST 使用统一字段结构输出每轮运行的质量等级与关键标量，以支持跨次结果比较

#### Scenario: 负向用例通过
- **WHEN** 用例验证审批拒绝、工作区阻塞或其他预期负向路径且断言通过
- **THEN** 指标文件 MUST 将 `caseStatus` 记录为 `passed`，同时保留真实 `executionStatus` 与 `executionResultCode`

#### Scenario: human 任务完成但存在绕路恢复
- **WHEN** human 用例最终完成任务，但过程中出现工具失败恢复或重复调用
- **THEN** 指标文件 MUST 记录真实完成终态，并通过质量相关标量使该运行可被识别为低于无绕路完成的结果

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

测试结果契约 MUST 输出 `signals.json` 作为非标量结构化信号文件，至少包含 `toolSequence`、`toolCounts`、`toolResultCodeCounts`、`failedAssertionIds`，并在适用时包含 `scenarioTags`、`expectedOutcome` 与 suite 专有的最终动作信号；当 suite 为 `main-ai-human` 时，`signals.json` 还 MUST 输出 `taskGoal`、`maxSteps`、`approvalPolicy`、`modelName`、`resultDataKeys`、`firstFailureStage` 等评估信号，并保留与恢复行为、步数预算边界和阻塞语义判断相关的结构化输入；当 suite 属于 renderer contract 或 e2e 测试时，`signals.json` SHOULD 额外包含 UI 交互与诊断信号，例如 `routeSequence`、`userActionSequence`、`ipcInvokeSequence`、`selectorFailures`、`consoleErrorCount`、`screenshotRefs`。

#### Scenario: 多工具用例生成结构化信号

- **WHEN** capability 或 human 用例执行多个工具步骤
- **THEN** `signals.json` MUST 保留工具调用顺序、按工具聚合的调用次数与结果码统计

#### Scenario: human 阻塞用例生成结构化信号

- **WHEN** human 用例以阻塞终态收敛
- **THEN** `signals.json` MUST 包含最终 human 动作、阻塞结果码以及相关审批或工作区证据的结构化索引

#### Scenario: human 完成用例生成评估信号
- **WHEN** human 用例完成任务并返回结构化结果
- **THEN** `signals.json` MUST 同时保留任务目标、步数预算、最终动作、结果字段键名与关键步骤序列，供后续分析器判定结果质量

#### Scenario: human 阻塞用例生成阻塞评估信号
- **WHEN** human 用例以审批拒绝、工作区缺失、步数预算耗尽或证据不足等阻塞终态收敛
- **THEN** `signals.json` MUST 包含最终 human 动作、阻塞结果码、首个失败阶段与相关阻塞证据的结构化索引

#### Scenario: renderer contract 或 e2e 测试生成 UI 诊断信号

- **WHEN** renderer contract、deterministic e2e 或 ai-live e2e 用例执行用户交互与页面跳转
- **THEN** `signals.json` SHOULD 记录关键路由、用户动作、IPC 调用序列和 selector 失败信息，供后续 AI 诊断消费

### Requirement: 摘要文件 MUST 仅转写事实性报告信号
`summary.md` MUST 只转写结构化报告中的事实性信号，用于人工快速阅读；摘要文件 MUST NOT 预写根因推断、优化建议或其他解释性分析文本。

#### Scenario: 生成事实摘要
- **WHEN** 任一测试用例完成并写入摘要文件
- **THEN** 摘要 MUST 仅包含 suite、caseStatus、executionStatus、关键统计与失败断言等事实信息

#### Scenario: 读取摘要进行人工核对
- **WHEN** 开发者查看 `summary.md`
- **THEN** 其内容 MUST 与 `assertions.json`、`metrics.json`、`signals.json` 保持一致，且不包含固定根因或优化建议段落
