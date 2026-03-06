## 1. 报告契约与类型重构

- [x] 1.1 在 `tests/ai/harness/types.ts` 中移除旧的固定分析类型，定义新的 `caseStatus`、`caseErrorCode`、`executionStatus`、`executionResultCode`、`signals` 相关类型
- [x] 1.2 重构 `tests/ai/harness/reporter.ts` 的落盘输入结构，使其支持输出 `events.jsonl`、`assertions.json`、`metrics.json`、`signals.json`、`summary.md`
- [x] 1.3 重构 `tests/ai/harness/reportInspector.ts` 的读取类型与解析逻辑，使其消费新报告 schema 而不是旧的分析字段

## 2. 结构化信号生成与执行语义接入

- [x] 2.1 在 reporter 中实现从事件流与断言结果推导通用指标与结构化信号的逻辑，包括工具序列、工具计数、工具结果码统计、失败断言 ID、审批统计与产物统计
- [x] 2.2 在 `runCapabilityCase` 中接入新的 case 错误分类与 execution outcome 注入机制，支持 capability 用例显式声明真实执行语义
- [x] 2.3 在 `runHumanLiveCase` 中接入新的 case 错误分类与 execution outcome 汇总逻辑，并将 `HumanTaskOutput` 映射到统一报告字段
- [x] 2.4 重写 `summary.md` 生成功能，确保摘要仅转写事实性信号，不再输出固定根因或优化建议

## 3. 回归用例与报告消费迁移

- [x] 3.1 更新依赖旧 `failure_category` 字段的 capability fail-fast 回归用例，改为断言新的 `caseErrorCode` 与 `executionStatus`
- [x] 3.2 更新依赖旧 `failure_category` 字段的 human-live fail-fast 回归用例，改为断言新的 `caseErrorCode` 与 `executionStatus`
- [x] 3.3 更新现有 docx 与 human-live 正负向用例，使其在需要时补充 `expectedOutcome`、`scenarioTags` 或 execution outcome 声明
- [x] 3.4 运行 AI 测试相关回归，确认新报告文件集、断言读取逻辑与负向场景语义均符合预期

## 4. 文档与规范同步

- [x] 4.1 更新 `doc/testing.md`，将报告契约说明改为“原始证据 + 结构化信号 + 事实摘要”
- [x] 4.2 更新 `tests/ai/README.md`，同步新的报告文件集合、关键字段与推荐消费方式
- [x] 4.3 核对实现与本 change 下的 delta specs 保持一致，必要时补充字段命名或场景说明以消除歧义
