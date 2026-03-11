## MODIFIED Requirements

### Requirement: 报告落盘路径与命名 MUST 标准化

测试结果 MUST 按统一目录层级落盘到 `tests/report/<suite>/<case>/<timestamp>/` 下，并包含标准文件集合 `events.jsonl`、`assertions.json`、`metrics.json`、`signals.json`、`summary.md`，避免结果覆盖并支持历史追踪；当 suite 属于 renderer contract 或 e2e 测试时，系统 MAY 在同级目录附加 UI 证据文件或子目录（如截图、trace、console、DOM snapshot），但 MUST NOT 替代标准文件集合。

#### Scenario: 生成 capability 用例报告

- **WHEN** capability 用例执行结束
- **THEN** 报告 MUST 写入 `tests/report/<suite>/<case>/<timestamp>/` 下的标准文件集合

#### Scenario: 生成 human live 用例报告

- **WHEN** human live 用例执行结束
- **THEN** 报告 MUST 与 capability 用例使用同一目录规范并可区分 suite 类型

#### Scenario: 生成 e2e 用例报告

- **WHEN** deterministic e2e 或 ai-live e2e 用例执行结束
- **THEN** 报告 MUST 写入标准文件集合，并在适用时附带截图、trace 或其他 UI 证据文件

### Requirement: 报告契约 MUST 输出结构化信号文件供后续分析器消费

测试结果契约 MUST 输出 `signals.json` 作为非标量结构化信号文件，至少包含 `toolSequence`、`toolCounts`、`toolResultCodeCounts`、`failedAssertionIds`，并在适用时包含 `scenarioTags`、`expectedOutcome` 与 suite 专有的最终动作信号；当 suite 属于 renderer contract 或 e2e 测试时，`signals.json` SHOULD 额外包含 UI 交互与诊断信号，例如 `routeSequence`、`userActionSequence`、`ipcInvokeSequence`、`selectorFailures`、`consoleErrorCount`、`screenshotRefs`。

#### Scenario: 多工具用例生成结构化信号

- **WHEN** capability 或 human live 用例执行多个工具步骤
- **THEN** `signals.json` MUST 保留工具调用顺序、按工具聚合的调用次数与结果码统计

#### Scenario: human 阻塞用例生成结构化信号

- **WHEN** human live 用例以阻塞终态收敛
- **THEN** `signals.json` MUST 包含最终 human 动作、阻塞结果码以及相关审批或工作区证据的结构化索引

#### Scenario: renderer contract 或 e2e 测试生成 UI 诊断信号

- **WHEN** renderer contract、deterministic e2e 或 ai-live e2e 用例执行用户交互与页面跳转
- **THEN** `signals.json` SHOULD 记录关键路由、用户动作、IPC 调用序列和 selector 失败信息，供后续 AI 诊断消费
