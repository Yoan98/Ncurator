## Why

当前 `main context` 阶段已经有一轮 runtime baseline，但覆盖面仍以 prompt、scope、fail-fast 与 draft review 契约为主，尚不能稳定回答“context 轮次是否真的帮助 main graph 收敛，以及何时需要调整 intent/context prompt 或 routing”。在继续推进 `plan 质量` 之前，需要先补齐可重复、可比较、可归因的 context 测试样本与分析信号，避免后续把质量问题、边界回归和状态机问题混在一起判断。

## What Changes

- 新增面向 `main context` 阶段的测试能力，覆盖 deterministic graph-level case 与有限的 live evaluation case。
- 为 `main context` 测试定义首批关键样本，至少保护“context 解开歧义”“context 轮次上限降级”“无效证据不放大状态”“证据不足时保留不确定性”“scope/local-first 在 context 往返中不漂移”等高风险路径。
- 扩展测试报告契约与分析输入，使 runtime/context 用例能够输出 context 专属结构化信号与比较指标，用于判断问题更接近状态机、prompt/objective 还是边界约束。
- 明确 `main context` 阶段的结果判读口径，使后续升级记录可以基于 context 收敛率、触顶降级率、假澄清与范围漂移等信号决定是否需要继续调整。

## Capabilities

### New Capabilities
- `main-context-test-suite`: 定义 `main context` 阶段的受治理测试样本、运行分层与判定目标，覆盖 deterministic graph-level 验证与批次化 live context 评估。

### Modified Capabilities
- `ai-test-reporting-contract`: 扩展 runtime/context 测试报告的指标与结构化信号，使 context 决策序列、context 轮次、证据增量、触顶降级与范围漂移等结果可被稳定记录和比较。

## Impact

- `tests/main/ai/runtime/**` 的 case 组织与 context 相关 managed case 清单
- `tests/harness/main/**` 的 graph-level runtime harness、事件采集与报告信号构建
- `tests/report/main-ai-runtime/**` 的报告字段与后续分析输入
- `scripts/**` 中与 runtime/context 汇总、对比或批次分析相关的脚本
- `doc/testing/**` 中关于 `main context` 阶段结论与推进依据的记录方式
