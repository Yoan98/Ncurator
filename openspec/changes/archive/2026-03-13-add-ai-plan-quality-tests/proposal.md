## Why

当前仓库已经覆盖了 AI runtime 的编排契约、human 单任务能力和工作台计划渲染，但还没有一组专门面向 `plan 质量` 的受治理测试来回答“计划拆解是否合理、任务粒度是否稳定、handoff 链是否会失真”。随着 `main context` 阶段基线已经通过，现在需要把 `plan 质量` 从已有 runtime correctness 测试中独立出来，形成可比较、可复盘、可用于后续 prompt/runtime 调整决策的测试能力。

## What Changes

- 新增一组面向 AI `plan 质量` 的规范能力，定义 planner contract、plan runtime 和 live quality 三层测试目标与最小覆盖面。
- 为 `main-ai-runtime` 补充专门的 plan quality managed case，覆盖“禁止 summary task 泄漏”“objective 完整性”“长 handoff 链”“中途阻塞仍 synthesis”“多资料范围混合”等场景。
- 约束 plan quality 测试结果必须能够通过现有 report/case catalog 体系读取，并支持后续在阶段文档和升级记录中做推进判断。
- 明确 plan quality 阶段的结果解释口径，使后续能够区分问题更偏向 planner prompt、objective/handoff 编译，还是 human 执行收敛。

## Capabilities

### New Capabilities
- `ai-plan-quality-test-suite`: 定义 AI plan 质量测试的分层覆盖、受治理 case 约束、结果分析信号与阶段推进口径。

### Modified Capabilities
- 无

## Impact

- 受影响系统：`tests/main/ai/runtime/**`、可能新增的 live plan quality case、`tests/catalog/**`、`tests/report/main-ai-runtime/**`
- 受影响文档：`doc/testing/phased-plan.md`、`doc/testing/upgrade-journal.md`，以及与 AI plan 测试读取路径相关的测试文档
- 受影响实现面：AI planner prompt/plan 节点、plan handoff objective 编译、runtime 报告消费与后续阶段决策流程
