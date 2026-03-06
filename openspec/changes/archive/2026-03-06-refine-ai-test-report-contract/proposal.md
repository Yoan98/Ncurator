## Why

当前 AI 测试报告在 `metrics.json` 和 `summary.md` 中预写了固定的分析字段，但这些字段并不基于真实事件流、断言结果或执行输出生成，信息增量很低，还会混淆“测试用例是否通过”和“被测系统实际发生了什么”。在准备扩展 docx 与 human-live 测试覆盖前，需要先把报告契约调整为“数据优先、分析后置”，让 Codex 能直接基于结构化证据做批量诊断与优化建议。

## What Changes

- 将 AI 测试报告从“固定分析文案”调整为“原始证据 + 结构化信号”契约，删除预写死的根因和优化建议文本。
- 将 case verdict 与 execution outcome 拆开表达，避免负向测试通过时被误读为“系统没有任何失败语义”。
- 为 capability 与 human-live 两类测试补充机器可读的报告语义，至少覆盖 case 错误分类、执行状态、执行结果码、失败断言、工具序列、审批与产物统计等分析输入。
- 保留事件流与断言文件作为原始证据来源，并将摘要文件收敛为事实性概览，不再承载推断性分析。
- **BREAKING**：调整现有 AI 测试报告 JSON/Markdown 契约及其读取逻辑、回归断言与相关文档说明。

## Capabilities

### New Capabilities

- 无

### Modified Capabilities

- `ai-test-reporting-contract`: 将测试报告从固定分析键契约调整为数据优先的结构化信号契约，并明确原始证据、聚合指标与执行语义的边界。
- `capability-tool-test-suite`: 要求 capability 用例输出可供后续分析器消费的确定性报告信号，并支持区分正向验证、负向验证与显式能力缺口场景。
- `human-live-test-suite`: 要求 human-live 用例将 case verdict 与实际 execution outcome 分离表达，避免阻塞型预期用例被报告误判。

## Impact

- 受影响代码：`tests/ai/harness/*` 报告类型、写入逻辑、读取逻辑与回归测试；相关 suite 用例的断言与报告消费方式。
- 受影响文档与规格：`doc/testing.md`、`tests/ai/README.md`、现有 OpenSpec 测试报告与测试套件相关 specs。
- 受影响系统：后续基于测试报告做聚合分析、优化建议生成或自动化诊断的 Codex/AI 流程。
