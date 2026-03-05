# ai-test-reporting-contract Specification

## Purpose
TBD - created by archiving change add-script-first-ai-testing-harness. Update Purpose after archive.
## Requirements
### Requirement: 测试框架 MUST 输出可回放事件流与结构化断言结果
每个测试用例执行后 MUST 输出完整事件流与断言明细，确保结果可回放、可审计、可定位。

#### Scenario: 用例执行完成
- **WHEN** 任一 capability 或 human live 用例结束
- **THEN** 系统 MUST 产出事件流文件与断言结果文件，且两者可按 runId/caseId 关联

#### Scenario: 用例失败定位
- **WHEN** 用例断言失败
- **THEN** 报告 MUST 提供对应失败断言、关联事件片段与关键上下文字段

### Requirement: 测试框架 MUST 输出统一指标文件用于横向比较
每个测试用例 MUST 输出统一指标结构，至少包含步骤数、失败码、耗时、工具调用统计与产物统计，便于跨运行对比。

#### Scenario: 多次运行同一用例
- **WHEN** 同一用例被执行多次
- **THEN** 指标文件 MUST 使用统一字段结构，以支持跨次结果比较

#### Scenario: 运行包含文件产物的用例
- **WHEN** 用例执行产生或更新文件
- **THEN** 指标输出 MUST 包含产物数量与操作类型统计

### Requirement: 报告契约 MUST 包含 AI 优化建议所需的分析键
测试结果契约 MUST 提供固定分析字段，至少包含 `failure_category`、`suspected_root_cause`、`optimization_hints`，以支持 AI 基于测试输出自动给出改进建议。

#### Scenario: 失败用例生成分析输入
- **WHEN** 用例失败并生成报告
- **THEN** 报告 MUST 填充失败分类与疑似根因字段，并提供可执行的优化提示列表

#### Scenario: 通过用例生成分析输入
- **WHEN** 用例通过并生成报告
- **THEN** 报告 MUST 保留分析键字段且以“无异常/可优化建议”形式输出

### Requirement: 报告落盘路径与命名 MUST 标准化
测试结果 MUST 按统一目录层级落盘，目录结构 MUST 至少包含 suite、case 与时间戳维度，避免结果覆盖并支持历史追踪。

#### Scenario: 生成 capability 用例报告
- **WHEN** capability 用例执行结束
- **THEN** 报告 MUST 写入 `artifacts/ai-test-results/<suite>/<case>/<timestamp>/` 下的标准文件集合

#### Scenario: 生成 human live 用例报告
- **WHEN** human live 用例执行结束
- **THEN** 报告 MUST 与 capability 用例使用同一目录规范并可区分 suite 类型

